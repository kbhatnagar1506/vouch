// Ported verbatim from aaditisinghal/vouch-aaditi's
// src/components/__tests__/gmail-connector.test.tsx (commit 55eedf7) — this
// repo's GmailConnector component matches the same states, fetch calls,
// error-code mapping and UI text, so the test needed no adaptation.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GmailConnector from "@/components/gmail-connector";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("<GmailConnector />", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a checking-connection placeholder before the status call resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<GmailConnector />);
    expect(screen.getByText("Checking connection…")).toBeInTheDocument();
  });

  it("shows a Connect Gmail link when not connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ connected: false, email: null })),
    );
    render(<GmailConnector />);

    const link = await screen.findByRole("link", { name: "Connect Gmail" });
    expect(link).toHaveAttribute("href", "/api/connectors/gmail/connect");
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("falls back to a disconnected state if the status fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network error"))),
    );
    render(<GmailConnector />);

    expect(
      await screen.findByRole("link", { name: "Connect Gmail" }),
    ).toBeInTheDocument();
  });

  it("shows the connected email and a Connected badge when already connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ connected: true, email: "user@gmail.com" })),
    );
    render(<GmailConnector />);

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("user@gmail.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View recent emails" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("maps a known initialError code to a friendly message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ connected: false, email: null })),
    );
    render(<GmailConnector initialError="access_denied" />);

    expect(
      await screen.findByText("You declined Gmail access."),
    ).toBeInTheDocument();
  });

  it("falls back to a generic message for an unrecognized initialError code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ connected: false, email: null })),
    );
    render(<GmailConnector initialError="some_unmapped_code" />);

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
  });

  it("loads and renders recent messages on click", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/connectors/gmail/status") {
        return jsonResponse({ connected: true, email: "user@gmail.com" });
      }
      if (url === "/api/connectors/gmail/messages") {
        return jsonResponse({
          email: "user@gmail.com",
          messages: [
            { id: "1", subject: "Hello", from: "a@b.com", date: "" },
            { id: "2", subject: "", from: "c@d.com", date: "" },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GmailConnector />);
    await user.click(await screen.findByRole("button", { name: "View recent emails" }));

    expect(await screen.findByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("(no subject)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/connectors/gmail/messages");
  });

  it("shows 'No messages found.' when the inbox is empty", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/connectors/gmail/status") {
          return jsonResponse({ connected: true, email: "user@gmail.com" });
        }
        return jsonResponse({ email: "user@gmail.com", messages: [] });
      }),
    );

    render(<GmailConnector />);
    await user.click(await screen.findByRole("button", { name: "View recent emails" }));

    expect(await screen.findByText("No messages found.")).toBeInTheDocument();
  });

  it("shows the server error message when loading messages fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/connectors/gmail/status") {
          return jsonResponse({ connected: true, email: "user@gmail.com" });
        }
        return jsonResponse({ error: "Gmail not connected" }, false, 409);
      }),
    );

    render(<GmailConnector />);
    await user.click(await screen.findByRole("button", { name: "View recent emails" }));

    expect(await screen.findByText("Gmail not connected")).toBeInTheDocument();
  });

  it("disconnects and returns to the not-connected state", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/connectors/gmail/status") {
        return jsonResponse({ connected: true, email: "user@gmail.com" });
      }
      if (url === "/api/connectors/gmail/disconnect") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GmailConnector />);
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Connect Gmail" }),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/connectors/gmail/disconnect", {
      method: "POST",
    });
  });
});
