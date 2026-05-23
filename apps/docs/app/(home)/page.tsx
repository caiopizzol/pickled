import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center text-center flex-1 gap-6 max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold">pickled</h1>
      <p className="text-lg">
        Test what agents actually understand about your product.
      </p>
      <p className="text-sm opacity-80">
        Pickled runs scenarios against real agent targets, checks that answers
        cite registered sources, and matches declared traps against the
        response. Scoring is deterministic by contract. No LLM grades another
        LLM.
      </p>
      <div className="flex gap-3 justify-center">
        <Link href="/docs" className="font-medium underline underline-offset-4">
          Read the docs
        </Link>
        <Link
          href="https://github.com/caiopizzol/pickled"
          className="font-medium underline underline-offset-4"
        >
          GitHub
        </Link>
      </div>
    </div>
  );
}
