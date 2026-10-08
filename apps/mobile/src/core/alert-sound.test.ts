import test from "node:test";
import assert from "node:assert/strict";
import { alertSound } from "./alert-sound.ts";

test("default and silent previews cannot fall through to a Mill chime", () => {
  for (const event of ["chat", "visitor", "message"] as const) {
    assert.equal(alertSound("system", event), "default");
    assert.equal(alertSound("silent", event), null);
  }
});

test("voice alerts distinguish an incoming chat from a new visitor", () => {
  assert.equal(alertSound("voice", "chat"), "mill-voice-conversation.wav");
  assert.equal(alertSound("voice", "visitor"), "mill-voice-visitor.wav");
  assert.equal(alertSound("voice", "message"), "mill-voice-message.wav");
  assert.equal(alertSound("mill", "visitor"), "mill-conversation.wav");
  assert.equal(alertSound("mill", "message"), "mill-message.wav");
});
