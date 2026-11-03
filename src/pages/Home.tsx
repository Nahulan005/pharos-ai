import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { DemoNotice } from '../components/States'

export default function Home() {
  return <>
    <section className="home-hero">
      <div className="hero-copy"><p className="eyebrow"><span className="signal-dot" /> A LITTLE DIRECTION. MORE POSSIBILITY.</p><h1>Your next chapter<br />starts with <span>discovery.</span></h1><p className="hero-description">Find your way through scholarships, learning opportunities and student software benefits. Clear information, all in one place.</p><Link to="/explore" className="button button-primary">Explore opportunities <Icon name="arrow" /></Link><p className="hero-footnote">Free to explore. Built with students in mind.</p></div>
      <div className="compass-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="compass-center"><Icon name="compass" /></div><span className="orbit-label label-one">LEARN</span><span className="orbit-label label-two">DISCOVER</span><span className="orbit-label label-three">GROW</span></div>
    </section>
    <DemoNotice />
    <section className="home-categories" aria-labelledby="paths-title"><div className="section-heading"><div><p className="eyebrow">MAKE ROOM FOR POSSIBILITY</p><h2 id="paths-title">Three ways to move forward</h2></div><Link className="text-link" to="/explore">Browse all <Icon name="arrow" /></Link></div>
      <div className="path-grid">
        <Link className="path-card" to="/explore?category=scholarship"><span className="category-icon"><Icon name="scholarship" /></span><h3>Support your studies</h3><p>Explore scholarship information, eligibility and application timelines.</p><span className="text-link">Scholarships <Icon name="arrow" /></span></Link>
        <Link className="path-card" to="/explore?category=course_cert"><span className="category-icon"><Icon name="book" /></span><h3>Build your knowledge</h3><p>Discover courses with clear information about learning and certificate costs.</p><span className="text-link">Courses & certificates <Icon name="arrow" /></span></Link>
        <Link className="path-card" to="/explore?category=software_perk"><span className="category-icon"><Icon name="software" /></span><h3>Find your next tool</h3><p>Explore software benefits and check what’s available to students.</p><span className="text-link">Software benefits <Icon name="arrow" /></span></Link>
      </div>
    </section>
    <div className="trust-note"><Icon name="shield" /><div><h3>Clarity before opportunity.</h3><p>Unknown details stay unknown. Even a source-checked record is not a guarantee of eligibility or availability.</p></div></div>
  </>
}
