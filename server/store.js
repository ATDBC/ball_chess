import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assertStoredMatchV1 } from "./match-schema.js";

export class MatchStore {
  constructor({ directory }) {
    this.directory = directory;
  }

  async save(record) {
    await mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `${record.id}.json`);
    const temporary = path.join(this.directory, `.${record.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async loadAll() {
    await mkdir(this.directory, { recursive: true });
    const records = [];
    const failures = [];
    for (const file of (await readdir(this.directory)).filter((name) => name.endsWith(".json"))) {
      const matchId = path.basename(file, ".json");
      try {
        const record = JSON.parse(await readFile(path.join(this.directory, file), "utf8"));
        assertStoredMatchV1(record, matchId);
        records.push(record);
      } catch (error) {
        failures.push({ matchId, file, message: error.message });
      }
    }
    return { records, failures };
  }
}
