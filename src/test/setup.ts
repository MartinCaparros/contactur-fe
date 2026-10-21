import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
// El default de 1 s de `findBy*`/`waitFor` alcanza en una máquina libre, pero varias
// suites montan el shell completo y resuelven dos o tres consultas antes del primer
// aserto. Con los workers de Vitest compitiendo por CPU en el contenedor compartido,
// eso fallaba de forma intermitente (cada corrida en un test distinto) sin que la UI
// tuviera un problema. 8 s sigue muy por debajo de `testTimeout` (20 s).
configure({ asyncUtilTimeout: 8000 });

// T16: ninguna suite abre un websocket real. El fake conecta y suscribe solo por
// defecto (modo `live`, sin authorizer ni red); `t16-realtime` lo controla a mano.
// La configuración pública de Reverb se fija para que las pruebas no dependan del
// entorno del contenedor o de CI.
vi.mock("pusher-js", () => import("./fakePusher"));
process.env.NEXT_PUBLIC_REVERB_APP_KEY = "contactur-test-key";
process.env.NEXT_PUBLIC_REVERB_HOST = "localhost";
process.env.NEXT_PUBLIC_REVERB_PORT = "6001";
process.env.NEXT_PUBLIC_REVERB_SCHEME = "http";

beforeEach(async () => {
  const { fakePusher } = await import("./fakePusher");
  fakePusher.reset();
});
