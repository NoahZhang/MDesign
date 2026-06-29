import { useState } from 'react'
import { X } from 'lucide-react'
import { dismissTutorial } from '../../lib/store'
import GuideModal from './GuideModal'

function AppleBook() {
  return (
    <svg width="86" height="78" viewBox="0 0 86 78" fill="none" aria-hidden>
      {/* book */}
      <path d="M10 56c10-5 23-5 33 0 10-5 23-5 33 0v8c-10-5-23-5-33 0-10-5-23-5-33 0v-8Z" fill="#C9D3DF" />
      <path d="M43 56V64" stroke="#9FB0C0" strokeWidth="1.5" />
      <path d="M10 56c10-5 23-5 33 0 10-5 23-5 33 0" stroke="#9FB0C0" strokeWidth="1.5" fill="none" />
      {/* apple */}
      <path
        d="M43 30c-3-4-9-4-12 0-3 4-2 12 2 17 2 3 4 4 6 4s4-1 6-4c4-5 5-13 2-17-3-4-9-4-12 0"
        fill="#A9B6A0"
      />
      <path d="M43 28c0-4 2-7 6-8" stroke="#7E8C76" strokeWidth="2" strokeLinecap="round" fill="none" />
      <ellipse cx="49" cy="20" rx="4" ry="2.4" transform="rotate(-30 49 20)" fill="#8B9A82" />
    </svg>
  )
}

export default function TutorialCard() {
  const [showGuide, setShowGuide] = useState(false)
  return (
    <div className="relative text-left">
      <button
        onClick={() => setShowGuide(true)}
        className="relative flex h-[150px] w-full items-center justify-center rounded-xl2 border border-[#C9D6E4] bg-gradient-to-b from-[#D7E5F2] to-[#C5D8EC] transition-shadow hover:shadow-raised"
      >
        <AppleBook />
      </button>
      <button
        onClick={dismissTutorial}
        className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-full text-[#5b6b7d] transition-colors hover:bg-white/50"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
      <div className="mt-3">
        <div className="text-[15px] font-semibold text-ink">Learn about MDesign</div>
        <button
          onClick={() => setShowGuide(true)}
          className="mt-0.5 text-[12.5px] font-medium text-coral-dark hover:underline"
        >
          Quick tutorial
        </button>
      </div>
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
    </div>
  )
}
