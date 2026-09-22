// Code-execution container — a Cloudflare Container (Durable Object) that runs
// the Python exec_server, for agent code runs.
import { Container } from "@cloudflare/containers";

export class CodeExecContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
  enableInternet = false;
  pingEndpoint = "/health";
}
