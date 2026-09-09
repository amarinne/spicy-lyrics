import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Exercise the real clock with only its Spotify/store imports replaced.
const source = stripTypeScriptTypes(readFileSync(new URL("../src/utils/Gets/GetProgress.ts", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, ""))
  .replace(/export default /g, "")
  .replace(/export /g, "");

function clock() {
  let now = 10_000;
  let raw = 1000;
  let playing = true;
  let uri = "spotify:track:first";
  let offset = 0;
  const state = { positionAsOfTimestamp: 5000, timestamp: now };
  const context = {
    Date: { now: () => now },
    console,
    setTimeout: () => {},
    $playbackOffset: { get: () => offset },
    SpotifyPlayer: { IsPlaying: true, GetUri: () => uri, GetId: () => uri, GetDuration: () => 300_000, GetContentType: () => "track" },
    Spicetify: {
      Player: { isPlaying: () => playing },
      Platform: {
        PlaybackAPI: { _isLocal: true },
        PlayerAPI: { _state: state, _contextPlayer: { getPositionState: async () => ({ position: raw }) } },
      },
    },
  };
  const api = runInNewContext(`${source}\n({ requestPositionSync, GetProgress, sample: () => syncedPosition, usingState: () => localSourceHealth?.UsingState });`, context);
  return {
    api, state,
    setPlaying: (value: boolean) => { playing = value; },
    setUri: (value: string) => { uri = value; },
    setOffset: (value: number) => { offset = value; },
    async poll(elapsed = 0, position = raw) {
      now += elapsed;
      raw = position;
      api.requestPositionSync();
      await Promise.resolve();
      await Promise.resolve();
      return api.sample().Position;
    },
  };
}

test("stalled local source switches to timestamped state after 500ms", async () => {
  const c = clock();
  assert.equal(await c.poll(), 1000);
  assert.equal(await c.poll(500), 1000);
  assert.equal(await c.poll(1), 5501);
  assert.equal(await c.poll(1000), 6501);
  c.state.positionAsOfTimestamp = 20_000;
  assert.equal(await c.poll(16), 21_517);
  c.setUri("spotify:track:second");
  c.state.positionAsOfTimestamp = 0;
  c.state.timestamp += 1517;
  assert.equal(await c.poll(16), 16);
});

test("healthy samples stay local and recovery requires three consecutive changes", async () => {
  const c = clock();
  await c.poll();
  assert.equal(await c.poll(16, 1016), 1016);
  await c.poll(501);
  assert.equal(c.api.usingState(), true);
  assert.equal(await c.poll(16, 1032), 5533);
  await c.poll(16);
  await c.poll(16, 1048);
  await c.poll(16, 1064);
  assert.equal(c.api.usingState(), true);
  assert.equal(await c.poll(16, 1080), 1080);
  assert.equal(c.api.usingState(), false);
});

test("long pause does not count as a stall and offset remains applied", async () => {
  const c = clock();
  await c.poll();
  c.setPlaying(false);
  await c.poll(60_000);
  c.setOffset(200);
  assert.equal(c.api.GetProgress(), 800);
  c.setPlaying(true);
  assert.equal(await c.poll(16), 1000);
  assert.equal(c.api.usingState(), false);
});

test("state fallback survives pause and requires a new recovery streak after resume", async () => {
  const c = clock();
  await c.poll();
  await c.poll(501);
  await c.poll(16, 1016);
  await c.poll(16, 1032);
  c.setPlaying(false);
  await c.poll(60_000, 1048);
  assert.equal(c.api.usingState(), true);
  c.setPlaying(true);
  await c.poll(16, 1064);
  assert.equal(c.api.usingState(), true);
  await c.poll(16, 1080);
  assert.equal(c.api.usingState(), true);
  assert.equal(await c.poll(16, 1096), 1096);
});

test("unavailable player state keeps the extrapolating local anchor", async () => {
  const c = clock();
  c.state.positionAsOfTimestamp = Number.NaN;
  await c.poll();
  assert.equal(await c.poll(501), 1000);
  assert.equal(c.api.GetProgress(), 1601);
});
