import { useEffect } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Icon } from './components/Icon'
import { NotFound } from './components/States'
import Home from './pages/Home'
import Explore from './pages/Explore'
import OpportunityDetails from './pages/OpportunityDetails'
import Profile from './pages/Profile'

function Shell() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = `${pathname === '/' ? 'Your next possibility' : pathname === '/explore' ? 'Opportunity Explorer' : pathname === '/profile' ? 'Student Profile' : 'Opportunity details'} · PHAROS`
    window.scrollTo(0, 0)
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [pathname])
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar"><Link className="brand" to="/" aria-label="PHAROS home"><span className="brand-mark"><Icon name="compass" /></span><span>PHAROS<span className="brand-subtitle">A clearer way forward</span></span></Link><p className="nav-heading">YOUR SPACE</p><nav aria-label="Main navigation"><NavLink to="/" end><Icon name="home" />Home</NavLink><NavLink to="/explore"><Icon name="compass" />Opportunity Explorer</NavLink><NavLink to="/profile"><Icon name="profile" />Student Profile</NavLink></nav><div className="sidebar-note"><span className="signal-dot" /><strong>Small steps. New possibilities.</strong><p>A place to discover what could come next.</p></div><div className="sidebar-bottom">PHAROS <span>Student companion</span></div></aside>
    <div className="main-area"><header className="topbar"><span>DISCOVER YOUR DIRECTION</span><span className="preview-label"><span className="signal-dot" />Demo preview</span></header><main id="main-content" tabIndex={-1}><Routes><Route path="/" element={<Home />} /><Route path="/explore" element={<Explore />} /><Route path="/explore/:id" element={<OpportunityDetails />} /><Route path="/profile" element={<Profile />} /><Route path="*" element={<NotFound />} /></Routes></main><footer className="app-footer"><span>PHAROS · A clearer way forward.</span><span>Built for curiosity. Grounded in context.</span></footer></div>
  </div>
}
export default function App() { return <BrowserRouter><Shell /></BrowserRouter> }
