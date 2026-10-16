import { describe, expect, test } from "bun:test";
import { previewUrl } from "../src/sync/preview.js";

describe("previewUrl", () => {
  test("uses the first 8 chars of the sha as subdomain and the project as path", () => {
    expect(
      previewUrl("a1b2c3d4e5f6a7b8c9d0", "docs.itzemoji.com", "test"),
    ).toBe("https://a1b2c3d4.docs.itzemoji.com/test");
  });
});
