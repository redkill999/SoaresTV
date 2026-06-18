import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/home")({
  component: () => <div className="min-h-screen p-10 text-2xl">Home OK</div>,
});
