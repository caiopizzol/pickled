import { CTA, Example, Footer, Hero, Nav } from "../src/components";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Example />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
