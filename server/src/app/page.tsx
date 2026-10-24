// This backend is an API-only service for the Fungu Flutter app — there's
// no web frontend to speak of, this page just exists so `app/` has a root
// route. See ../app/README.md for the actual client.
export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 40 }}>
      <h1>Fungu API</h1>
      <p>This is the backend for the Fungu Flutter app — see /app in the repo for the client.</p>
    </main>
  );
}
