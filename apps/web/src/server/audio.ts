import { extname } from "node:path";

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
