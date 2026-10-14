import { projjHome } from "./environment.js";
// The launcher adds app/bin to PATH. Only this helper is granted execution.
export async function request(method, data = {}) {
  const result = await process.run("projj-desktop-backend", [
    JSON.stringify({ ...data, method, home: projjHome }),
  ]);
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      result.stderr ||
        "The Projj backend did not return a response. Run scripts/dev.sh to build and launch the app.",
    );
  }
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
