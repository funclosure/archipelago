// Every migration, in order, as text. Imported rather than read from disk so the hosted build bundles them;
// `tests/core/db.test.ts` fails if a .sql file in this folder is missing here.

import m0001 from "./0001_initial.sql" with { type: "text" };
import m0002 from "./0002_positions.sql" with { type: "text" };
import m0003 from "./0003_threads.sql" with { type: "text" };
import m0004 from "./0004_landmarks.sql" with { type: "text" };
import m0005 from "./0005_harbour.sql" with { type: "text" };
import m0006 from "./0006_asks.sql" with { type: "text" };
import m0007 from "./0007_board.sql" with { type: "text" };
import m0008 from "./0008_mentor.sql" with { type: "text" };
import m0009 from "./0009_cartographer.sql" with { type: "text" };
import m0010 from "./0010_angle.sql" with { type: "text" };
import m0011 from "./0011_description.sql" with { type: "text" };
import m0012 from "./0012_seas.sql" with { type: "text" };
import m0013 from "./0013_suggested_seas.sql" with { type: "text" };
import m0014 from "./0014_language.sql" with { type: "text" };

export const MIGRATIONS: readonly { version: string; sql: string }[] = [
  { version: "0001_initial", sql: m0001 },
  { version: "0002_positions", sql: m0002 },
  { version: "0003_threads", sql: m0003 },
  { version: "0004_landmarks", sql: m0004 },
  { version: "0005_harbour", sql: m0005 },
  { version: "0006_asks", sql: m0006 },
  { version: "0007_board", sql: m0007 },
  { version: "0008_mentor", sql: m0008 },
  { version: "0009_cartographer", sql: m0009 },
  { version: "0010_angle", sql: m0010 },
  { version: "0011_description", sql: m0011 },
  { version: "0012_seas", sql: m0012 },
  { version: "0013_suggested_seas", sql: m0013 },
  { version: "0014_language", sql: m0014 },
];
