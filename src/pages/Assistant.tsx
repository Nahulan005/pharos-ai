import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { createAssistantChat } from '../lib/assistantChat'
import { aiClient, MAX_QUESTION_LENGTH } from '../services/aiClient'

const prompts = [
  'What should I verify before applying for a student scholarship?',
  'Help me compare the prerequisites for web development and machine learning.',
  'How can I evaluate whether a free course is useful for my goals?',
]

export default function Assistant() {
  const [chat] = useState(() => createAssistantChat(aiClient))
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot)
  const [question, setQuestion] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const pending = state.status === 'loading'
  useEffect(() => () => chat.cancel(), [chat])
  const send = () => {
    if (!question.trim() || pending || !aiClient.configured) return
    void chat.send(question)
    // Retain the draft so failed or cancelled requests can be edited and retried explicitly.
  }
  const reset = () => { chat.reset(); setQuestion(''); input.current?.focus() }
  return <>
    <header className="page-heading"><p className="eyebrow">ASK WITH CURIOSITY. VERIFY WITH SOURCES.</p><h1>PHAROS <span>AI Research</span></h1><p>A space to research opportunities, compare learning paths and ask better questions.</p></header>
    <section className="assistant-shell" aria-label="Research assistant">
      <header className="assistant-toolbar"><div><Icon name="compass" /><strong>Research workspace</strong><span className="assistant-connection">{aiClient.configured ? 'Backend configured · availability unverified' : 'Backend not configured'}</span></div><button className="button button-secondary" onClick={reset} disabled={!state.messages.length && !question && !state.error && !pending}>Clear chat</button></header>
      {state.status === 'unavailable' && <div className="assistant-notice" role="status"><Icon name="info" /><div><h2>PHAROS AI Research is not connected yet.</h2><p>{aiClient.configured ? 'The configured backend is unavailable. You can edit your question and send it again later.' : 'Sending is disabled until the PHAROS backend is configured. You can draft a question, but no AI answer will be generated here.'}</p><div className="assistant-links"><Link to="/explore">Explore opportunities</Link><Link to="/profile">Student Profile</Link><Link to="/roadmap">Career Roadmap</Link></div></div></div>}
      <div className="assistant-messages" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
        {!state.messages.length && <div className="assistant-empty"><span className="brand-mark"><Icon name="search" /></span><h2>Start with a student-focused question</h2><p>Answers will appear here only when a connected backend returns them. Suggested prompts below are question starters, not generated answers.</p></div>}
        {state.messages.map(message => <article className={`assistant-message ${message.role}`} key={message.id} aria-label={message.role === 'user' ? 'Your question' : 'Assistant response'}><strong className="assistant-speaker">{message.role === 'user' ? 'YOU' : 'PHAROS AI'}</strong>{message.role === 'user' ? <p className="assistant-answer">{message.text}</p> : <>
          <p className="assistant-grounding">{message.response.grounded ? 'Backend reports this answer is grounded in the sources below.' : 'Not grounded in verified sources. Treat this as general guidance.'}</p><p className="assistant-answer">{message.response.answer}</p>
          {message.response.citations.length > 0 && <section className="assistant-citations" aria-label="Answer sources"><h3>Sources to check</h3><ol>{message.response.citations.map((citation, index) => <li key={`${citation.url}-${index}`}><a href={citation.url} target="_blank" rel="noopener noreferrer">{citation.title} <Icon name="external" /></a></li>)}</ol></section>}
          <p className="assistant-disclaimer">Sources and grounding are supplied by the backend, not independently verified by this interface. Confirm eligibility, deadlines and availability with the provider.</p>
        </>}</article>)}
      </div>
      {pending && <div className="assistant-request-status" role="status"><span className="spinner" />Waiting for the research backend…<button className="button button-secondary" onClick={chat.cancel}>Cancel request</button></div>}
      {state.error && <p className="assistant-error" role="alert">{state.error} Your question is still in the editor.</p>}
      <div className="assistant-prompts" role="group" aria-label="Suggested questions">{prompts.map(prompt => <button key={prompt} disabled={pending} onClick={() => { setQuestion(prompt); input.current?.focus() }}>{prompt}<Icon name="arrow" /></button>)}</div>
      <form className="assistant-composer" onSubmit={event => { event.preventDefault(); send() }}><label htmlFor="research-question">Your research question</label><textarea ref={input} id="research-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={MAX_QUESTION_LENGTH} rows={3} placeholder="What would you like to understand?" aria-describedby="assistant-input-hint" disabled={pending} />
        <div className="assistant-composer-actions"><span>{question.length} / {MAX_QUESTION_LENGTH}</span><button className="button button-primary" type="submit" disabled={!aiClient.configured || pending || !question.trim()}>{pending ? 'Waiting…' : 'Send question'}<Icon name="arrow" /></button></div>
        <p id="assistant-input-hint">{aiClient.configured ? 'Sending shares this question with the configured PHAROS backend. Profile data and earlier messages are not sent.' : 'Send is unavailable until a backend is configured.'} Each question is independent. Avoid personal or sensitive information. Chat is held in memory and cleared when you leave this page or reload.</p>
      </form>
    </section>
  </>
}
