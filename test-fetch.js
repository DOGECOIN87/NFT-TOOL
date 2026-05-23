async function run() {
  const res = await fetch("https://raw.githubusercontent.com/DOGECOIN87/sweetardios2/main/assets/background/Toasted.webp");
  console.log("Status:", res.status);
  console.log("Headers:", Object.fromEntries(res.headers.entries()));
}
run();
