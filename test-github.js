async function run() {
  const res = await fetch("https://api.github.com/repos/DOGECOIN87/sweetardios2/contents/assets/background");
  const data = await res.json();
  console.log(data.map(f => f.name));
}
run();
