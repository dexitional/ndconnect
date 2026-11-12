export const money = (pesewas: number) =>
  `GHC ${(pesewas / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const audioFormats =
  "audio/*,.mp3,.wav,.flac,.aac,.wma,.m4a,.ogg,.opus,.webm,.aif,.aiff,.amr,.3gp,.mp4,.caf,.mka,.ac3,.ape,.wv";
