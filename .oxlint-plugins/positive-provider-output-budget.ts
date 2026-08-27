// Provider call configs must carry a positive output budget.
//
// Detection boundary: object properties named `maxOutputTokens` whose value is a numeric literal
// at or below zero. Dynamic values remain the type system and runtime's responsibility.

const propertyName = (node: any): string | null => {
  if (node?.computed) return null;
  if (node?.key?.type === "Identifier") return node.key.name;
  if (node?.key?.type === "Literal" && typeof node.key.value === "string") return node.key.value;
  return null;
};

const numericValue = (node: any): number | null => {
  if (node?.type === "Literal" && typeof node.value === "number") return node.value;
  if (node?.type === "UnaryExpression" && node.operator === "-"
      && node.argument?.type === "Literal" && typeof node.argument.value === "number") {
    return -node.argument.value;
  }
  return null;
};

export default {
  meta: { name: "positive-provider-output-budget" },
  rules: {
    "positive-provider-output-budget": {
      meta: {
        type: "problem",
        messages: {
          invalidBudget: "Provider call configuration needs a positive maxOutputTokens value. Use a base config before the runtime derives the call budget.",
        },
      },
      create(context: any) {
        return {
          Property(node: any) {
            if (propertyName(node) !== "maxOutputTokens") return;
            const value = numericValue(node.value);
            if (value !== null && value <= 0) {
              context.report({ node: node.value, messageId: "invalidBudget" });
            }
          },
        };
      },
    },
  },
};
