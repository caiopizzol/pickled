import { CTA, Features, Footer, Hero, Nav, Steps } from "./components";

function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Features />
        <Steps />
        <CTA />
      </main>
      <Footer />
    </>
  );
}

export default App;
