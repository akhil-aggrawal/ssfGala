import { describe, expect, it } from "vitest";
import { placeholderHeading } from "./site";

describe("placeholderHeading", () => {
  it("names the gala and its tagline", () => {
    expect(placeholderHeading()).toBe(
      "Small Steps Foundation Gala: An Evening That Moves You",
    );
  });
});
