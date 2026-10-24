import Link from "next/link";

export default function Home() {
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <p className="hero__eyebrow">Small Steps Foundation Gala</p>
        <h1 id="hero-title" className="hero__title">
          An Evening That Moves You
        </h1>
        <ul className="hero__details">
          <li>
            <time dateTime="2027-01-23">Saturday, January 23, 2027</time>
          </li>
          <li>6:30 – 11:00 PM</li>
          <li>ICC Milpitas</li>
        </ul>
        <p className="hero__reception">
          Founders &amp; Friends reception at 5:30 PM
        </p>
        <div className="hero__actions">
          <Link href="/tickets" className="button button--primary">
            Buy Tickets
          </Link>
          <Link href="/sponsor" className="button button--secondary">
            Sponsor a Table
          </Link>
        </div>
      </section>

      <section id="about" className="about" aria-labelledby="about-title">
        <h2 id="about-title">About the Gala</h2>
        <p>
          The Small Steps Foundation Gala brings friends and supporters
          together for an evening of dinner and celebration. Funds raised
          support the We Fee Inc. project in Bihar.
        </p>
      </section>
    </main>
  );
}
