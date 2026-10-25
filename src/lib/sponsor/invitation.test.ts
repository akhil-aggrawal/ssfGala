import { describe, expect, it } from "vitest";
import { invitationEmail, invitationText } from "./invitation";

const input = {
  eventName: "An Evening That Moves You",
  sponsorName: "Acme Family",
  tier: "Gold",
  url: "https://gala.test/invite/abc",
};

describe("invitationEmail", () => {
  it("has a subject and a body naming the tier, the sponsor and the table link", () => {
    const { subject, body } = invitationEmail(input);
    expect(subject).toBe("You're invited: An Evening That Moves You");
    expect(body).toContain("Gold table");
    expect(body).toContain("Acme Family");
    expect(body).toContain("An Evening That Moves You");
    expect(body.split("\n")).toContain("https://gala.test/invite/abc");
  });
});

describe("invitationText", () => {
  it("puts the subject line first, then the body", () => {
    expect(invitationText({ subject: "Hi", body: "Line 1\nLine 2" })).toBe("Subject: Hi\n\nLine 1\nLine 2");
  });
});
