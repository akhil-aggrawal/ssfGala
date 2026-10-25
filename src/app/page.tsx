import Image from "next/image";
import Link from "next/link";
import poster from "../../public/images/save-the-date.jpg";

export default function Home() {
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
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
        </div>
        {/* The poster's own text is repeated in the alt text for screen readers. */}
        <Image
          className="hero__poster"
          src={poster}
          alt="Save the date poster: Small Steps Foundation, An Evening That Moves You. Dance, comedy, music, giving. Saturday, January 23, 2027, 6:30 to 11:00 PM, ICC Milpitas. From Bricks to Books: 20 years, brick by brick, building brighter futures. Founders and Friends reception at 5:30 PM."
          priority
          sizes="(min-width: 56rem) 26rem, 90vw"
        />
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
