export const money = (pesewas: number) =>
  `GHC ${(pesewas / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const audioFormats = ".mp3,.wav,.flac,.aac,.wma,.m4a,.ogg";
