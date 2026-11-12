import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import ffmpeg from "ffmpeg-static";

export async function audioFixture(extension: string, duration = 0.25) {
  const directory = await mkdtemp(resolve(tmpdir(), "ndcms-audio-fixture-"));
  try {
    const target = resolve(directory, `tone.${extension}`);
    await promisify(execFile)(ffmpeg!, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000",
      "-t",
      String(duration),
      "-ac",
      "1",
      target,
    ]);
    return await readFile(target);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
