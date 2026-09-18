import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { orderByDependencies } from "@/lib/backup/engine";
import { resolveTopics } from "@/lib/backup/topics";

const catalog = {
  generated_at: "2026-09-18T10:00:00Z",
  tables: [
    { name: "psakei_din", rows: 5093, bytes: 60_000_000, pk: ["id"], columns: ["id"], depends_on: [] },
    { name: "psak_sections", rows: 6221, bytes: 40_000_000, pk: ["id"], columns: ["id"], depends_on: ["psakei_din"] },
    { name: "user_preferences", rows: 1, bytes: 48_000, pk: ["id"], columns: ["id"], depends_on: [] },
    { name: "brand_new_table", rows: 3, bytes: 16_000, pk: ["id"], columns: ["id"], depends_on: [] },
  ],
  buckets: [{ id: "user-books", public: true, files: 3, bytes: 1_000_000 }],
};

const createBackup = vi.fn();

vi.mock("@/lib/backup/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/backup/engine")>();
  return {
    ...actual,
    loadCatalog: vi.fn(async () => catalog),
    listBackups: vi.fn(async () => []),
    listRestores: vi.fn(async () => []),
    createBackup: (...args: unknown[]) => createBackup(...args),
  };
});

import DataBackupPanel from "@/components/backup/DataBackupPanel";

describe("backup topics", () => {
  it("puts unknown tables in the 'other' topic so nothing is left out", () => {
    const topics = resolveTopics(catalog.tables.map((t) => t.name), ["user-books"]);
    const all = topics.flatMap((t) => t.tables);
    expect(all.sort()).toEqual(catalog.tables.map((t) => t.name).sort());
    expect(topics.find((t) => t.id === "other")?.tables).toEqual(["brand_new_table"]);
    expect(topics.find((t) => t.id === "files")?.buckets).toEqual(["user-books"]);
  });

  it("orders parents before children for restore", () => {
    const order = orderByDependencies(["psak_sections", "psakei_din", "user_preferences"], {
      psak_sections: ["psakei_din"],
    });
    expect(order.indexOf("psakei_din")).toBeLessThan(order.indexOf("psak_sections"));
  });
});

describe("DataBackupPanel", () => {
  beforeEach(() => {
    createBackup.mockReset();
    createBackup.mockResolvedValue({ backupId: "b1", status: "completed", manifest: { tables: {} } });
  });

  it("selects everything by default and backs up only what stays selected", async () => {
    render(<DataBackupPanel open onOpenChange={() => {}} />);

    const selectAll = await screen.findByRole("checkbox", { name: "בחר הכל" });
    expect(selectAll).toHaveAttribute("data-state", "checked");
    expect(screen.getByText("פסקי דין")).toBeInTheDocument();
    expect(screen.getByText("אחר")).toBeInTheDocument();

    // Untick the whole "settings" topic, then back up to the cloud only
    const settingsRow = screen.getByText("הגדרות והעדפות").closest("div.rounded-lg") as HTMLElement;
    fireEvent.click(within(settingsRow).getAllByRole("checkbox")[0]);
    expect(selectAll).toHaveAttribute("data-state", "indeterminate");

    fireEvent.click(screen.getByText("ענן בלבד"));
    fireEvent.click(screen.getByRole("button", { name: /התחל גיבוי/ }));

    await waitFor(() => expect(createBackup).toHaveBeenCalledTimes(1));
    const opts = createBackup.mock.calls[0][0];
    expect(opts.tables.sort()).toEqual(["brand_new_table", "psak_sections", "psakei_din"]);
    expect(opts.buckets).toEqual(["user-books"]);
    expect(opts.toCloud).toBe(true);
    expect(opts.zip).toBeNull();
    expect(opts.kind).toBe("cloud");
  });

  it("clear selection disables the backup button", async () => {
    render(<DataBackupPanel open onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "נקה בחירה" }));
    expect(screen.getByRole("button", { name: /התחל גיבוי/ })).toBeDisabled();
  });
});
