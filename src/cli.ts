import { Command } from "commander";
import { DateTime } from "luxon";
import fs from "node:fs";
import path from "node:path";
import asciichart from "asciichart";
import sparkly from "sparkly";
import * as vega from "vega";
import * as vegaLite from "vega-lite";
import { collectClaude } from "./collectors/claude.js";
import { collectCodex } from "./collectors/codex.js";
import { collectCursor, buildWorkspaceActivityMap, findProjectForTimestamp } from "./collectors/cursor.js";
import { collectOpenClaw } from "./collectors/openclaw.js";
import { collectApprentice } from "./collectors/apprentice.js";
import { loadConfig, resolveTimezone, resolveBillingSessionsFile } from "./core/config.js";
import { applyCosting } from "./core/cost.js";
import { loadSummaries, loadEventsForRange, aggregateEvents } from "./core/aggregate.js";
import { getPaths, ensurePaths } from "./core/paths.js";
import { loadPricingTable } from "./core/pricing.js";
import { readSyncState, writeSyncState } from "./core/state.js";
import { writeEvents, loadAllStoredEvents, overwriteEvents } from "./core/storage.js";
import { formatBreakdown, formatTotalsLine, formatUsd } from "./cli/utils.js";
import { setVerbose, debug } from "./core/logger.js";
import { readJsonl } from "./core/events.js";
import type { UsageEvent, UsageProvider } from "./core/events.js";

type BreakdownKey = "provider" | "project" | "model" | "source" | "billing";

function isBreakdownKey(value: string): value is BreakdownKey {
  return ["provider", "project", "model", "source", "billing"].includes(value);
}

const program = new Command();

program
  .name("thinktax")
  .description("Multi-provider LLM cost tracker")
  .option("--config <path>", "override config path")
  .option("--timezone <tz>", "override timezone for reporting")
  .option("-v, --verbose", "enable verbose output for debugging")
  .hook("preAction", () => {
    const opts = program.opts();
    if (opts.verbose) {
      setVerbose(true);
    }
  });

program
  .command("refresh")
  .description("Collect latest usage and write normalized events")
  .action(async () => {
    const options = program.opts();
    const { config, path: configPath, exists } = loadConfig(options.config);
    debug("Config loaded from:", configPath, exists ? "(found)" : "(missing)");

    const paths = getPaths();
    ensurePaths(paths);
    debug("Data paths:", paths);

    const pricing = loadPricingTable();
    debug("Loaded pricing for", Object.keys(pricing).length, "providers");

    const includeUnknown = config.ui?.includeUnknown ?? false;

    debug("Starting collectors...");
    const [claudeEvents, codexEvents, cursorEvents, openclawEvents, apprenticeEvents] = await Promise.all([
      collectClaude(config).then((events) => {
        debug("Claude collector returned", events.length, "events");
        return events;
      }),
      collectCodex(config).then((events) => {
        debug("Codex collector returned", events.length, "events");
        return events;
      }),
      collectCursor(config).then((events) => {
        debug("Cursor collector returned", events.length, "events");
        return events;
      }),
      collectOpenClaw(config).then((events) => {
        debug("OpenClaw collector returned", events.length, "events");
        return events;
      }),
      collectApprentice(config).then((events) => {
        debug("Apprentice collector returned", events.length, "events");
        return events;
      }),
    ]);

    const rawEvents = [...claudeEvents, ...codexEvents, ...cursorEvents, ...openclawEvents, ...apprenticeEvents];
    debug("Total raw events:", rawEvents.length);

    const costed = rawEvents.map((event) =>
      applyCosting(event, pricing, { includeUnknown })
    );
    debug("Applied costing to all events");

    const written = await writeEvents(costed);
    debug("Wrote", written, "new events to storage");

    const sync = readSyncState();
    sync.lastRun = {
      ...(sync.lastRun ?? {}),
      claude: new Date().toISOString(),
      codex: new Date().toISOString(),
      cursor: new Date().toISOString(),
      openclaw: new Date().toISOString(),
      apprentice: new Date().toISOString(),
    };
    sync.counts = {
      ...(sync.counts ?? {}),
      claude: claudeEvents.length,
      codex: codexEvents.length,
      cursor: cursorEvents.length,
      openclaw: openclawEvents.length,
      apprentice: apprenticeEvents.length,
    };
    writeSyncState(sync);

    console.log(
      `Collected ${rawEvents.length} events (${written} new). Claude ${claudeEvents.length}, Codex ${codexEvents.length}, Cursor ${cursorEvents.length}, OpenClaw ${openclawEvents.length}, Apprentice ${apprenticeEvents.length}.`
    );
  });

program
  .command("status")
  .description("Show usage totals")
  .option("--json", "output JSON")
  .option("--breakdown <kind>", "provider|project|model|source")
  .option("--today", "only show today")
  .option("--mtd", "only show month-to-date")
  .option("--ytd", "only show year-to-date")
  .option("--all", "only show all-time")
  .action(async (cmd) => {
    const options = program.opts();
    const { config } = loadConfig(options.config);
    const timezone = options.timezone ?? resolveTimezone(config);
    const now = DateTime.now().setZone(timezone);

    const summaries = await loadSummaries(timezone, now);

    if (cmd.json) {
      const payload = {
        today: summaries.today,
        mtd: summaries.mtd,
        ytd: summaries.ytd,
        all: summaries.all,
      };
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    const explicit =
      cmd.today || cmd.mtd || cmd.ytd || cmd.all;
    const showToday = explicit ? cmd.today : true;
    const showMtd = explicit ? cmd.mtd : true;
    const showYtd = explicit ? cmd.ytd : false;
    const showAll = explicit ? cmd.all : false;

    const breakdownKey =
      typeof cmd.breakdown === "string" ? cmd.breakdown : null;

    if (showToday) {
      console.log(formatTotalsLine("Today", summaries.today.totals));
      if (breakdownKey && isBreakdownKey(breakdownKey)) {
        const lines = formatBreakdown(
          summaries.today.breakdowns[breakdownKey] ?? {},
          10
        );
        lines.forEach((line) => console.log(`  ${line}`));
      }
    }

    if (showMtd) {
      console.log(formatTotalsLine("MTD", summaries.mtd.totals));
      if (breakdownKey && isBreakdownKey(breakdownKey)) {
        const lines = formatBreakdown(
          summaries.mtd.breakdowns[breakdownKey] ?? {},
          10
        );
        lines.forEach((line) => console.log(`  ${line}`));
      }
    }

    if (showYtd) {
      console.log(formatTotalsLine("YTD", summaries.ytd.totals));
      if (breakdownKey && isBreakdownKey(breakdownKey)) {
        const lines = formatBreakdown(
          summaries.ytd.breakdowns[breakdownKey] ?? {},
          10
        );
        lines.forEach((line) => console.log(`  ${line}`));
      }
    }

    if (showAll) {
      console.log(formatTotalsLine("All Time", summaries.all.totals));
      if (breakdownKey && isBreakdownKey(breakdownKey)) {
        const lines = formatBreakdown(
          summaries.all.breakdowns[breakdownKey] ?? {},
          10
        );
        lines.forEach((line) => console.log(`  ${line}`));
      }
    }
  });

program
  .command("sketchybar")
  .description("Output Sketchybar payload")
  .option("--format <format>", "plain|json", "plain")
  .action(async (cmd) => {
    const options = program.opts();
    const { config } = loadConfig(options.config);
    const timezone = options.timezone ?? resolveTimezone(config);
    const now = DateTime.now().setZone(timezone);
    const { today, mtd } = await loadSummaries(timezone, now);

    const todayProvider = today.breakdowns.provider;
    const todayCursor = todayProvider.cursor?.final_usd ?? 0;
    const todayClaude = todayProvider.anthropic?.final_usd ?? 0;
    const todayCodex = todayProvider.openai?.final_usd ?? 0;

    const mtdProvider = mtd.breakdowns.provider;
    const mtdCursor = mtdProvider.cursor?.final_usd ?? 0;
    const mtdClaude = mtdProvider.anthropic?.final_usd ?? 0;
    const mtdCodex = mtdProvider.openai?.final_usd ?? 0;

    const todayTotalLabel = formatUsd(today.totals.final_usd);
    const mtdTotalLabel = formatUsd(mtd.totals.final_usd);
    const label = `today ${todayTotalLabel}`;

    const sync = readSyncState();
    const lastRun = sync.lastRun?.cursor ?? sync.lastRun?.claude ?? null;
    const stale = lastRun
      ? DateTime.fromISO(lastRun).diffNow("hours").hours < -24
      : true;
    const estimateOnly = today.totals.reported_usd === 0 && today.totals.estimated_usd > 0;

    if (cmd.format === "json") {
      console.log(
        JSON.stringify(
          {
            label,
            stale,
            estimateOnly,
            today: {
              total: { usd: today.totals.final_usd, label: todayTotalLabel },
              providers: {
                cursor: { usd: todayCursor, label: formatUsd(todayCursor) },
                claude: { usd: todayClaude, label: formatUsd(todayClaude) },
                codex: { usd: todayCodex, label: formatUsd(todayCodex) },
              },
            },
            mtd: {
              total: { usd: mtd.totals.final_usd, label: mtdTotalLabel },
              providers: {
                cursor: { usd: mtdCursor, label: formatUsd(mtdCursor) },
                claude: { usd: mtdClaude, label: formatUsd(mtdClaude) },
                codex: { usd: mtdCodex, label: formatUsd(mtdCodex) },
              },
            },
          },
          null,
          2
        )
      );
    } else {
      const prefix = `${stale ? "!" : ""}${estimateOnly ? "~" : ""}`;
      console.log(prefix + label);
    }
  });

program
  .command("popup")
  .description("Output popup payload")
  .option("--format <format>", "text|json", "text")
  .option("--today", "only show today")
  .option("--mtd", "only show month-to-date")
  .option("--ytd", "only show year-to-date")
  .option("--all", "only show all-time")
  .action(async (cmd) => {
    const options = program.opts();
    const { config } = loadConfig(options.config);
    const timezone = options.timezone ?? resolveTimezone(config);
    const now = DateTime.now().setZone(timezone);
    const summaries = await loadSummaries(timezone, now);

    if (cmd.format === "json") {
      console.log(JSON.stringify(summaries, null, 2));
      return;
    }

    const explicit =
      cmd.today || cmd.mtd || cmd.ytd || cmd.all;
    const showToday = explicit ? cmd.today : true;
    const showMtd = explicit ? cmd.mtd : true;
    const showYtd = explicit ? cmd.ytd : false;
    const showAll = explicit ? cmd.all : false;

    if (showToday) {
      console.log(formatTotalsLine("Today", summaries.today.totals));
      formatBreakdown(summaries.today.breakdowns.provider).forEach((line) =>
        console.log(`  ${line}`)
      );
    }

    if (showMtd) {
      console.log(formatTotalsLine("MTD", summaries.mtd.totals));
      formatBreakdown(summaries.mtd.breakdowns.provider).forEach((line) =>
        console.log(`  ${line}`)
      );
    }

    if (showYtd) {
      console.log(formatTotalsLine("YTD", summaries.ytd.totals));
      formatBreakdown(summaries.ytd.breakdowns.provider).forEach((line) =>
        console.log(`  ${line}`)
      );
    }

    if (showAll) {
      console.log(formatTotalsLine("All Time", summaries.all.totals));
      formatBreakdown(summaries.all.breakdowns.provider).forEach((line) =>
        console.log(`  ${line}`)
      );
    }
  });

program
  .command("doctor")
  .description("Diagnostics for thinktax")
  .action(() => {
    const options = program.opts();
    const { config, path: configPath, exists } = loadConfig(options.config);
    const paths = getPaths();
    const sync = readSyncState();

    console.log(`Config: ${configPath} (${exists ? "found" : "missing"})`);
    console.log(`Data dir: ${paths.dataDir}`);
    console.log(`Events dir: ${paths.eventsDir}`);
    console.log(`Snapshots dir: ${paths.snapshotsDir}`);
    console.log(`State dir: ${paths.stateDir}`);

    if (sync.lastRun) {
      Object.entries(sync.lastRun).forEach(([key, value]) => {
        console.log(`Last ${key} refresh: ${value}`);
      });
    }

    if (config.cursor?.team) {
      console.log(
        `Cursor Team API: ${config.cursor.team.spendUrl ?? "configured"}`
      );
    }
  });

program
  .command("reprocess")
  .description("Re-apply costing and project attribution to all stored events")
  .option("--dry-run", "show what would be changed without writing")
  .action(async (cmd) => {
    const options = program.opts();
    const { config } = loadConfig(options.config);
    const pricing = loadPricingTable();
    const includeUnknown = config.ui?.includeUnknown ?? false;

    console.log("Loading all stored events...");
    const events = await loadAllStoredEvents();
    console.log(`Found ${events.length} events to reprocess`);

    if (events.length === 0) {
      console.log("No events to reprocess.");
      return;
    }

    // Load billing registry for Claude Code sessions
    const billingFile = resolveBillingSessionsFile();
    const billingEntries = await readJsonl<{ session_id: string; billing: string }>(billingFile);
    const billingRegistry = new Map<string, string>();
    for (const entry of billingEntries) {
      if (entry.session_id && entry.billing) {
        billingRegistry.set(entry.session_id, entry.billing);
      }
    }
    const defaultBilling = config.claude?.billing?.defaultMode ?? "estimate";
    console.log(`Billing registry: ${billingRegistry.size} tagged sessions, default: ${defaultBilling}`);

    // Build Cursor workspace activity map for project attribution
    console.log("Building Cursor workspace activity map...");
    const cursorActivityMap = buildWorkspaceActivityMap();
    console.log(`Found ${cursorActivityMap.workspaces.size} Cursor workspaces`);

    let costingUpdated = 0;
    let billingTagged = 0;
    let projectsAttributed = 0;
    const reprocessed: UsageEvent[] = [];

    for (const event of events) {
      let updated = false;

      // Apply billing tag to Claude Code events
      if (event.source === "claude_code") {
        const filePath = (event.meta?.file as string) ?? "";
        const sessionId = path.basename(filePath, ".jsonl");
        const billing = billingRegistry.get(sessionId) ?? defaultBilling;
        if (event.meta?.billing !== billing) {
          event.meta = { ...event.meta, billing };
          billingTagged++;
          updated = true;
        }
      }

      // Apply billing tag to OpenClaw events
      if (event.source === "openclaw") {
        const openclawBilling = config.openclaw?.billing?.defaultMode ?? "estimate";
        if (event.meta?.billing !== openclawBilling) {
          event.meta = { ...event.meta, billing: openclawBilling };
          billingTagged++;
          updated = true;
        }
      }

      // Re-apply costing
      const oldFinalUsd = event.cost.final_usd;
      const recosted = applyCosting(event, pricing, { includeUnknown });

      if (recosted.cost.final_usd !== oldFinalUsd) {
        costingUpdated++;
        updated = true;
      }

      // Re-apply Cursor project attribution
      if (event.source === "cursor_ide" && !event.project.id) {
        const eventTimestampMs = DateTime.fromISO(event.ts).toMillis();
        const project = findProjectForTimestamp(cursorActivityMap, eventTimestampMs);
        if (project.id) {
          recosted.project = project;
          projectsAttributed++;
          updated = true;
        }
      }

      reprocessed.push(recosted);
    }

    console.log(`\nChanges:`);
    console.log(`  Billing tagged: ${billingTagged} events`);
    console.log(`  Costing updated: ${costingUpdated} events`);
    console.log(`  Projects attributed: ${projectsAttributed} Cursor events`);

    if (cmd.dryRun) {
      console.log("\n(Dry run - no changes written)");
      return;
    }

    if (costingUpdated === 0 && projectsAttributed === 0 && billingTagged === 0) {
      console.log("\nNo changes needed.");
      return;
    }

    console.log("\nWriting updated events...");
    const written = await overwriteEvents(reprocessed);
    console.log(`Wrote ${written} events to storage.`);
  });

program
  .command("graph")
  .description("Show cost over time as ASCII chart")
  .option("--days <n>", "number of days to show", "30")
  .option("--provider <provider>", "filter by provider (cursor|anthropic|openai)")
  .option("--height <n>", "chart height in lines", "12")
  .option("--sparkline", "compact sparkline output")
  .option("--image [path]", "generate PNG image (default: /tmp/thinktax-graph.png)")
  .option("--open", "open generated image (macOS)")
  .action(async (cmd) => {
    const options = program.opts();
    const { config } = loadConfig(options.config);
    const timezone = options.timezone ?? resolveTimezone(config);
    const now = DateTime.now().setZone(timezone);

    const days = Math.max(1, Math.min(365, parseInt(cmd.days, 10) || 30));
    const height = Math.max(5, Math.min(30, parseInt(cmd.height, 10) || 12));
    const providerFilter = cmd.provider as UsageProvider | undefined;

    const startDate = now.minus({ days: days - 1 }).startOf("day");
    const events = await loadEventsForRange(timezone, startDate, now);

    // Filter by provider if specified
    const filtered = providerFilter
      ? events.filter((e) => e.provider === providerFilter)
      : events;

    // Aggregate costs by day
    const dailyCosts: Map<string, number> = new Map();
    for (let d = 0; d < days; d++) {
      const day = startDate.plus({ days: d }).toISODate();
      if (day) dailyCosts.set(day, 0);
    }

    for (const event of filtered) {
      const eventDay = DateTime.fromISO(event.ts).setZone(timezone).toISODate();
      if (eventDay && dailyCosts.has(eventDay)) {
        dailyCosts.set(eventDay, (dailyCosts.get(eventDay) ?? 0) + (event.cost.final_usd ?? 0));
      }
    }

    // Convert to array for chart
    const sortedDays = Array.from(dailyCosts.keys()).sort();
    const values = sortedDays.map((day) => dailyCosts.get(day) ?? 0);

    if (values.every((v) => v === 0)) {
      console.log(`No cost data for the last ${days} days.`);
      return;
    }

    const total = values.reduce((a, b) => a + b, 0);
    const avg = total / days;
    const max = Math.max(...values);

    const title = providerFilter
      ? `${providerFilter} cost - last ${days} days`
      : `Total cost - last ${days} days`;

    // Sparkline mode - compact single line
    if (cmd.sparkline) {
      const spark = sparkly(values, { min: 0 });
      console.log(`${title}: ${spark} ${formatUsd(total)} total`);
      return;
    }

    // Image generation mode
    if (cmd.image !== undefined) {
      const imagePath = typeof cmd.image === "string" ? cmd.image : "/tmp/thinktax-graph.png";

      // Build data for Vega-Lite
      const chartData = sortedDays.map((day, i) => ({
        date: day,
        cost: values[i],
      }));

      const vlSpec = {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        width: 800,
        height: 400,
        padding: 20,
        background: "#1a1a1a",
        title: {
          text: title,
          color: "#ffffff",
          fontSize: 18,
        },
        data: { values: chartData },
        mark: {
          type: "area",
          line: { color: "#06b6d4" },
          color: {
            x1: 1, y1: 1, x2: 1, y2: 0,
            gradient: "linear",
            stops: [
              { offset: 0, color: "rgba(6, 182, 212, 0)" },
              { offset: 1, color: "rgba(6, 182, 212, 0.4)" },
            ],
          },
        },
        encoding: {
          x: {
            field: "date",
            type: "temporal",
            axis: {
              title: null,
              labelColor: "#888888",
              gridColor: "#333333",
              format: "%b %d",
            },
          },
          y: {
            field: "cost",
            type: "quantitative",
            axis: {
              title: "Cost (USD)",
              titleColor: "#888888",
              labelColor: "#888888",
              gridColor: "#333333",
              format: "$,.2f",
            },
          },
        },
      };

      try {
        const vegaSpec = vegaLite.compile(vlSpec as any).spec;
        const view = new vega.View(vega.parse(vegaSpec), { renderer: "none" });
        const canvas = await view.toCanvas();
        const buffer = canvas.toBuffer("image/png");
        fs.writeFileSync(imagePath, buffer);
        console.log(`Chart saved to: ${imagePath}`);
        console.log(`Total: ${formatUsd(total)}  |  Avg: ${formatUsd(avg)}/day  |  Max: ${formatUsd(max)}`);

        if (cmd.open && process.platform === "darwin") {
          const { execSync } = await import("node:child_process");
          execSync(`open "${imagePath}"`);
        }
        view.finalize();
      } catch (err) {
        console.error("Failed to generate image:", err);
      }
      return;
    }

    // Default: ASCII chart
    console.log(`\n${title}`);
    console.log("─".repeat(50));

    const chart = asciichart.plot(values, {
      height,
      format: (x: number) => formatUsd(x).padStart(8),
    });
    console.log(chart);

    // X-axis labels
    const labelLine = "  " + sortedDays[0].slice(5) + " ".repeat(Math.max(0, values.length - 12)) + sortedDays[sortedDays.length - 1].slice(5);
    console.log(labelLine);

    // Summary
    console.log("─".repeat(50));
    console.log(`Total: ${formatUsd(total)}  |  Avg: ${formatUsd(avg)}/day  |  Max: ${formatUsd(max)}`);
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
