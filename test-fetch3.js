async function run() {
  const res = await fetch("https://raw.githubusercontent.com/DOGECOIN87/sweetardios2/main/assets/background/Toasted.webp");
  const buf = await res.arrayBuffer();
  console.log("Buffer length:", buf.byteLength);
  console.log("Hex:", Buffer.from(buf).toString('hex'));
}
run();
