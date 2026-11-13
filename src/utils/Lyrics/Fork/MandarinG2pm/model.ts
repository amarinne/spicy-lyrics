/**
 * A direct TypeScript implementation of the pinned g2pM model.
 *
 * Official architecture (kakaobrain/g2pM 0.1.2.5, Apache-2.0):
 *   embedding 64 -> one-layer BiLSTM (32 hidden per direction) -> FC 32 -> ReLU -> FC 876.
 * PyTorch gate order is [input, forget, cell, output]. The official NumPy inference reverses
 * the sentence for the backward layer, runs the reverse weight matrices, and reverses the
 * resulting hidden states back. This module does the same.
 */

import type { ModelTensor } from "./data.ts";
import { canonicalNumbered } from "./pinyin.ts";

export type ModelTopReading = Readonly<{
  index: number;
  raw: string;
  logit: number;
  probability: number;
}>;

export type ModelPrediction = Readonly<{
  position: number;
  top: readonly ModelTopReading[];
}>;

const f = Math.fround;

function sigmoid(value: number): number {
  return f(1 / (1 + Math.exp(-value)));
}

function dot32(values: Float32Array, offset: number, weights: Float32Array, weightOffset: number, length: number): number {
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += values[offset + index]! * weights[weightOffset + index]!;
  return sum;
}

export class G2pMModel {
  readonly vocabularySize: number;
  readonly classCount: number;
  readonly embedding: Float32Array;
  readonly weightIh: Float32Array;
  readonly weightHh: Float32Array;
  readonly biasIh: Float32Array;
  readonly biasHh: Float32Array;
  readonly weightIhReverse: Float32Array;
  readonly weightHhReverse: Float32Array;
  readonly biasIhReverse: Float32Array;
  readonly biasHhReverse: Float32Array;
  readonly fc0Weight: Float32Array;
  readonly fc0Bias: Float32Array;
  readonly fc1Weight: Float32Array;
  readonly fc1Bias: Float32Array;
  readonly classes: readonly string[];

  private readonly inputSize = 64;
  private readonly hiddenSize = 32;

  constructor(tensors: ReadonlyMap<string, ModelTensor>, vocabularySize: number, classes: readonly string[]) {
    this.vocabularySize = vocabularySize;
    this.classCount = classes.length;
    this.classes = classes;
    this.embedding = tensor(tensors, "embedding.weight", [vocabularySize, this.inputSize]);
    this.weightIh = tensor(tensors, "lstm.weight_ih_l0", [this.hiddenSize * 4, this.inputSize]);
    this.weightHh = tensor(tensors, "lstm.weight_hh_l0", [this.hiddenSize * 4, this.hiddenSize]);
    this.biasIh = tensor(tensors, "lstm.bias_ih_l0", [this.hiddenSize * 4]);
    this.biasHh = tensor(tensors, "lstm.bias_hh_l0", [this.hiddenSize * 4]);
    this.weightIhReverse = tensor(tensors, "lstm.weight_ih_l0_reverse", [this.hiddenSize * 4, this.inputSize]);
    this.weightHhReverse = tensor(tensors, "lstm.weight_hh_l0_reverse", [this.hiddenSize * 4, this.hiddenSize]);
    this.biasIhReverse = tensor(tensors, "lstm.bias_ih_l0_reverse", [this.hiddenSize * 4]);
    this.biasHhReverse = tensor(tensors, "lstm.bias_hh_l0_reverse", [this.hiddenSize * 4]);
    this.fc0Weight = tensor(tensors, "logit_layer.0.weight", [this.hiddenSize, this.hiddenSize * 2]);
    this.fc0Bias = tensor(tensors, "logit_layer.0.bias", [this.hiddenSize]);
    this.fc1Weight = tensor(tensors, "logit_layer.2.weight", [this.classCount, this.hiddenSize]);
    this.fc1Bias = tensor(tensors, "logit_layer.2.bias", [this.classCount]);
  }

  /**
   * Run the whole sentence once. `positions` are zero-based indices into `inputIds`; the caller
   * includes the BOS/EOS tokens and maps a source character index to its shifted position.
   */
  predict(inputIds: readonly number[], positions: readonly number[], topK = 5): Map<number, ModelPrediction> {
    if (inputIds.length === 0) throw new TypeError("g2pM input must not be empty.");
    for (const id of inputIds) {
      if (!Number.isInteger(id) || id < 0 || id >= this.vocabularySize) throw new TypeError(`Invalid g2pM token id ${id}.`);
    }
    const length = inputIds.length;
    const forward = this.runLayer(inputIds, false);
    const backwardReversed = this.runLayer([...inputIds].reverse(), true);
    const backward = new Float32Array(length * this.hiddenSize);
    for (let position = 0; position < length; position += 1) {
      const source = (length - 1 - position) * this.hiddenSize;
      backward.set(backwardReversed.subarray(source, source + this.hiddenSize), position * this.hiddenSize);
    }

    const output = new Map<number, ModelPrediction>();
    const combined = new Float32Array(this.hiddenSize * 2);
    for (const position of positions) {
      if (!Number.isInteger(position) || position < 0 || position >= length) {
        throw new TypeError(`Invalid g2pM position ${position}.`);
      }
      combined.set(forward.subarray(position * this.hiddenSize, (position + 1) * this.hiddenSize), 0);
      combined.set(backward.subarray(position * this.hiddenSize, (position + 1) * this.hiddenSize), this.hiddenSize);
      output.set(position, { position, top: this.top(logits(combined, this), topK) });
    }
    return output;
  }

  /** Raw logits for one position, for numeric fidelity tests. */
  logitsAt(inputIds: readonly number[], position: number): Float32Array {
    const length = inputIds.length;
    const forward = this.runLayer(inputIds, false);
    const backwardReversed = this.runLayer([...inputIds].reverse(), true);
    const combined = new Float32Array(this.hiddenSize * 2);
    combined.set(forward.subarray(position * this.hiddenSize, (position + 1) * this.hiddenSize), 0);
    const source = (length - 1 - position) * this.hiddenSize;
    combined.set(backwardReversed.subarray(source, source + this.hiddenSize), this.hiddenSize);
    return logits(combined, this);
  }

  private top(rawLogits: Float32Array, count: number): ModelTopReading[] {
    let maximum = -Infinity;
    for (const value of rawLogits) if (value > maximum) maximum = value;
    let total = 0;
    const exponential = new Float32Array(rawLogits.length);
    for (let index = 0; index < rawLogits.length; index += 1) {
      const value = Math.exp(rawLogits[index]! - maximum);
      exponential[index] = value;
      total += value;
    }
    const indices = Array.from(rawLogits.keys()).sort((left, right) => rawLogits[right]! - rawLogits[left]! || left - right).slice(0, count);
    return indices.map((index) => ({
      index,
      raw: canonicalNumbered(this.classes[index]!) ?? this.classes[index]!,
      logit: rawLogits[index]!,
      probability: exponential[index]! / total,
    }));
  }

  /** One LSTM direction. `reverse` selects the reverse weight matrices, not a different traversal. */
  private runLayer(inputIds: readonly number[], reverse: boolean): Float32Array {
    const hiddenSize = this.hiddenSize;
    const inputSize = this.inputSize;
    const weightIh = reverse ? this.weightIhReverse : this.weightIh;
    const weightHh = reverse ? this.weightHhReverse : this.weightHh;
    const biasIh = reverse ? this.biasIhReverse : this.biasIh;
    const biasHh = reverse ? this.biasHhReverse : this.biasHh;
    const length = inputIds.length;
    const hiddenStates = new Float32Array(length * hiddenSize);
    const hidden = new Float32Array(hiddenSize);
    const cell = new Float32Array(hiddenSize);
    const nextHidden = new Float32Array(hiddenSize);
    const nextCell = new Float32Array(hiddenSize);
    const input = new Float32Array(inputSize);
    const gates = new Float32Array(hiddenSize * 4);

    for (let position = 0; position < length; position += 1) {
      const embeddingOffset = inputIds[position]! * inputSize;
      input.set(this.embedding.subarray(embeddingOffset, embeddingOffset + inputSize));
      for (let gate = 0; gate < hiddenSize * 4; gate += 1) {
        const inputPart = biasIh[gate]! + dot32(input, 0, weightIh, gate * inputSize, inputSize);
        const hiddenPart = biasHh[gate]! + dot32(hidden, 0, weightHh, gate * hiddenSize, hiddenSize);
        gates[gate] = f(f(inputPart) + f(hiddenPart));
      }
      for (let unit = 0; unit < hiddenSize; unit += 1) {
        const inputGate = sigmoid(gates[unit]!);
        const forgetGate = sigmoid(gates[hiddenSize + unit]!);
        const cellGate = f(Math.tanh(gates[hiddenSize * 2 + unit]!));
        const outputGate = sigmoid(gates[hiddenSize * 3 + unit]!);
        const next = f(f(forgetGate * cell[unit]!) + f(inputGate * cellGate));
        nextCell[unit] = next;
        nextHidden[unit] = f(outputGate * f(Math.tanh(next)));
      }
      hiddenStates.set(nextHidden, position * hiddenSize);
      hidden.set(nextHidden);
      cell.set(nextCell);
    }
    return hiddenStates;
  }
}

function tensor(tensors: ReadonlyMap<string, ModelTensor>, name: string, shape: readonly number[]): Float32Array {
  const found = tensors.get(name);
  if (!found) throw new TypeError(`Missing model tensor ${name}.`);
  if (found.spec.shape.length !== shape.length || found.spec.shape.some((size, index) => size !== shape[index])) {
    throw new TypeError(`Tensor ${name} has shape ${found.spec.shape.join("x")}, expected ${shape.join("x")}.`);
  }
  return found.values;
}

function logits(combined: Float32Array, model: G2pMModel): Float32Array {
  const hiddenSize = 32;
  const hidden = new Float32Array(hiddenSize);
  for (let unit = 0; unit < hiddenSize; unit += 1) {
    const value = f(model.fc0Bias[unit]! + dot32(combined, 0, model.fc0Weight, unit * 64, 64));
    hidden[unit] = value > 0 ? value : 0;
  }
  const output = new Float32Array(model.fc1Bias.length);
  for (let classIndex = 0; classIndex < output.length; classIndex += 1) {
    output[classIndex] = f(model.fc1Bias[classIndex]! + dot32(hidden, 0, model.fc1Weight, classIndex * hiddenSize, hiddenSize));
  }
  return output;
}
