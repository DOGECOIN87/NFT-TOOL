async function run() {
  const res = await fetch("https://raw.githubusercontent.com/DOGECOIN87/sweetardios2/main/assets/background/Toasted.webp");
  const text = await res.text();
  console.log("Response text:", text);
}
run();
