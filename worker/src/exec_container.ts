// Code-execution container — a Cloudflare Container (Durable Object) that runs
// the Python exec_server, for agent code runs.
import { Container } from "@cloudflare/containers";

export class CodeExecContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
  // Internet on so generated artifacts' dependencies (pip/npm) can install at
  // verification time. Container is ephemeral and holds no secrets.
  enableInternet = true;
  pingEndpoint = "/health";
}
