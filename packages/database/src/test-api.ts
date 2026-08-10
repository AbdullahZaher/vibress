async function test() {
  const res = await fetch('http://127.0.0.1:7780/api/content/v1/pages/style-guide');
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(text.slice(0, 500));
}
test().catch(console.error);
