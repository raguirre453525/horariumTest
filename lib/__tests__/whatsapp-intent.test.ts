import { describe, expect, it } from "vitest";
import { isDateInCurrentWeek, resolveEventDateRange, resolveNaturalDate } from "@/lib/whatsapp/dates";
import { splitLeadingNo } from "@/lib/whatsapp/engine";
import { FALLBACK_TEXT, formatConfirmSummary } from "@/lib/whatsapp/format";

const TIME_ZONE = "America/Argentina/Tucuman";

describe("WhatsApp dates and confirmation formatting", () => {
  it("resolves próximo martes strictly after today in Tucumán", () => {
    const now = new Date("2026-09-06T15:00:00.000Z");
    expect(resolveNaturalDate("el próximo martes", now, TIME_ZONE)).toBe("2026-09-08");
  });

  it("keeps friendly fallback copy and confirmation formatting", () => {
    expect(FALLBACK_TEXT).toContain("Te leo");
    expect(formatConfirmSummary("create_event", { title: "Parcial de RED", type: "parcial", date: "2026-09-08", subject_code: "RED" })).toContain("SI");
    expect(formatConfirmSummary("create_event", { title: "Parcial de RED", type: "parcial", date: "2026-09-08", subject_code: "RED" })).toContain("NO");
    expect(formatConfirmSummary("create_event", { title: "Parcial de RED", type: "parcial", date: "2026-09-08", subject_code: "RED" })).toContain("10 minutos");
    expect(isDateInCurrentWeek("2026-09-08", new Date("2026-09-07T15:00:00.000Z"), TIME_ZONE)).toBe(true);
  });

  it("resolves event weeks, months, explicit ranges, and scoped follow-ups", () => {
    const now = new Date("2026-09-06T15:00:00.000Z");
    expect(resolveEventDateRange("esta semana", now, TIME_ZONE)).toEqual({ from: "2026-08-31", to: "2026-09-06" });
    expect(resolveEventDateRange("la semana que viene", now, TIME_ZONE)).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(resolveEventDateRange("este mes", now, TIME_ZONE)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveEventDateRange("mañana", now, TIME_ZONE)).toEqual({ from: "2026-09-07", to: "2026-09-07" });
    expect(resolveEventDateRange("el jueves", now, TIME_ZONE)).toEqual({ from: "2026-09-10", to: "2026-09-10" });
    expect(resolveEventDateRange("del 7/9/2026 al 13/9/2026", now, TIME_ZONE)).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(resolveEventDateRange("y el jueves", now, TIME_ZONE, { from: "2026-09-07", to: "2026-09-13" })).toEqual({ from: "2026-09-10", to: "2026-09-10" });
  });

  it("splits a leading NO from the rest of the message", () => {
    expect(splitLeadingNo("no")).toBe("");
    expect(splitLeadingNo("No, gracias")).toBe("");
    expect(splitLeadingNo("no, quiero que edites el evento que ya esta creado")).toBe("quiero que edites el evento que ya esta creado");
    expect(splitLeadingNo("No quiero eso, cambialo")).toBe("quiero eso, cambialo");
    expect(splitLeadingNo("NO, QUIERO que lo EDITES")).toBe("QUIERO que lo EDITES");
    expect(splitLeadingNo("mejor no, dejalo para mañana")).toBe("dejalo para mañana");
    expect(splitLeadingNo("noviembre")).toBeNull();
    expect(splitLeadingNo("nota del parcial")).toBeNull();
    expect(splitLeadingNo("noche de cine")).toBeNull();
    expect(splitLeadingNo("quiero agendar algo")).toBeNull();
    expect(splitLeadingNo("si")).toBeNull();
  });
});
