import { extname, resolve } from "node:path";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { HTTPException } from "hono/http-exception";

const execute = promisify(execFile);
const maxAudioSize = 10 * 1024 * 1024;
let conversions = 0;

export async function prepareAudio(originalName: string, input: Buffer) {
  const extension = extname(originalName).toLowerCase();
  const safeName = originalName.replace(/[^\w. -]/g, "");
  if (extension === ".mp3" || extension === ".wav") {
    const mime = audioMime(originalName, input);
    if (!mime)
      throw new HTTPException(400, {
        message: "The recording does not match its audio format.",
      });
    return {
      bytes: input,
      filename:
        (safeName.slice(0, -extension.length).slice(0, 96) || "recording") +
        extension,
      mime,
      converted: false,
    };
  }
  if (conversions >= 2)
    throw new HTTPException(503, {
      message: "Audio conversion is busy. Please try uploading again shortly.",
    });
  const executable = process.env.FFMPEG_PATH || ffmpegPath;
  if (!executable)
    throw new HTTPException(503, {
      message:
        "Audio conversion is unavailable. Please upload MP3 or WAV, or contact your administrator.",
    });
  conversions++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(resolve(tmpdir(), "ndcms-audio-"));
    const source = resolve(directory, "input");
    const target = resolve(directory, "recording.wav");
    await writeFile(source, input, { mode: 0o600, flag: "wx" });
    await execute(
      executable,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-xerror",
        // Exclude playlists and network protocols; only decode self-contained media.
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        "aac,ac3,aiff,amr,ape,asf,au,caf,dts,eac3,flac,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mp3,ogg,oma,wav,wv",
        "-threads",
        "1",
        "-i",
        source,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-threads",
        "1",
        "-fs",
        String(maxAudioSize + 1),
        "-f",
        "wav",
        target,
      ],
      { timeout: 30000, killSignal: "SIGKILL", maxBuffer: 256 * 1024 },
    );
    if ((await stat(target)).size > maxAudioSize)
      throw new HTTPException(400, {
        message:
          "The converted WAV exceeds 10 MB. Please upload a shorter recording.",
      });
    const bytes = await readFile(target);
    if (bytes.length <= 44 || audioMime("recording.wav", bytes) !== "audio/wav")
      throw new HTTPException(400, {
        message: "This file does not contain a usable audio recording.",
      });
    const stem =
      safeName.slice(0, safeName.length - extension.length).slice(0, 96) ||
      "recording";
    return {
      bytes,
      filename: `${stem}.wav`,
      mime: "audio/wav",
      converted: true,
    };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    const unavailable = ["ENOENT", "EACCES"].includes(
      (error as NodeJS.ErrnoException).code || "",
    );
    throw new HTTPException(unavailable ? 503 : 400, {
      message: unavailable
        ? "Audio conversion is unavailable. Please upload MP3 or WAV, or contact your administrator."
        : "This recording could not be converted to WAV. It may be damaged or use an unsupported codec. Please export it as MP3 or WAV and try again.",
    });
  } finally {
    conversions--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export function audioMime(filename: string, bytes: Buffer): string | null {
  const extension = extname(filename).toLowerCase();
  const text = (start: number, end: number) =>
    bytes.toString("ascii", start, end);
  switch (extension) {
    case ".mp3":
      return text(0, 3) === "ID3" ||
        (bytes[0] === 0xff &&
          (bytes[1] & 0xe0) === 0xe0 &&
          (bytes[1] & 0x06) !== 0)
        ? "audio/mpeg"
        : null;
    case ".wav":
      return text(0, 4) === "RIFF" && text(8, 12) === "WAVE"
        ? "audio/wav"
        : null;
    case ".flac":
      return text(0, 4) === "fLaC" ? "audio/flac" : null;
    case ".aac":
      return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0
        ? "audio/aac"
        : null;
    case ".wma":
      return bytes.subarray(0, 16).toString("hex") ===
        "3026b2758e66cf11a6d900aa0062ce6c"
        ? "audio/x-ms-wma"
        : null;
    case ".m4a":
      return bytes.length >= 16 &&
        text(4, 8) === "ftyp" &&
        bytes.readUInt32BE(0) >= 16 &&
        bytes.readUInt32BE(0) <= bytes.length
        ? "audio/mp4"
        : null;
    case ".ogg": {
      const header = bytes.subarray(0, 4096);
      return text(0, 4) === "OggS" &&
        [
          Buffer.from("OpusHead"),
          Buffer.from("\x01vorbis"),
          Buffer.from("fLaC"),
        ].some((marker) => header.includes(marker))
        ? "audio/ogg"
        : null;
    }
    default:
      return null;
  }
}
