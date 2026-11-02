import type { RoadmapTrack } from '../models/roadmap'

const python = { title: 'Python tutorial (programming reference)', url: 'https://docs.python.org/3/tutorial/' }
const mdn = { title: 'MDN: Learn web development', url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development' }
const sklearn = { title: 'scikit-learn: Getting started', url: 'https://scikit-learn.org/stable/getting_started.html' }
const pytorch = { title: 'PyTorch tutorials', url: 'https://docs.pytorch.org/tutorials/' }
const node = { title: 'Node.js learning guide', url: 'https://nodejs.org/en/learn/getting-started/introduction-to-nodejs' }

/** Editorial estimates include reading and practice, not a promise of job readiness. */
export const roadmapTracks: RoadmapTrack[] = [
  {
    id: 'ai-ml', title: 'AI / Machine Learning Engineer', topic: 'ai_ml',
    description: 'Build programming and mathematical foundations before experimenting with models and evaluating their limitations.',
    steps: [
      { id: 'python-foundations', title: 'Programming foundations with Python', skills: ['Python', 'Programming'], prerequisites: [], hours: 45,
        project: 'Write a command-line study log using functions, lists and files. Add input checks and a few tests.',
        milestone: 'Explain your functions and debug the study log without copying a solution.', resources: [python] },
      { id: 'math-data', title: 'Mathematics and data foundations', skills: ['Statistics', 'Linear algebra'], prerequisites: ['python-foundations'], hours: 55,
        project: 'Use a small synthetic dataset to calculate averages, variance and vector operations. Explain sampling bias and missing values.',
        milestone: 'Explain probability, vectors, train/test separation and why a dataset may be misleading.', resources: [python, sklearn] },
      { id: 'classical-ml', title: 'Train and evaluate baseline models', skills: ['Machine learning', 'Scikit-learn'], prerequisites: ['math-data'], hours: 60,
        project: 'Compare a simple regression model with a baseline on synthetic data; use held-out evaluation and record errors.',
        milestone: 'Explain overfitting, leakage and your choice of evaluation metric.', resources: [sklearn] },
      { id: 'neural-networks', title: 'Neural network fundamentals', skills: ['PyTorch', 'Deep learning'], prerequisites: ['classical-ml'], hours: 55,
        project: 'Train a small network on a tutorial dataset. Track loss and compare results with a simpler baseline.',
        milestone: 'Explain tensors, gradients and when a neural network is unnecessary.', resources: [pytorch] },
      { id: 'ml-capstone', title: 'Reproducible ML portfolio project', skills: ['Model evaluation', 'Testing'], prerequisites: ['neural-networks'], hours: 55,
        project: 'Package a small predictor with tests, reproducible setup and a model card documenting intended use, bias and failure cases.',
        milestone: 'Another learner can reproduce your results and understand the model limitations.', resources: [sklearn, pytorch] },
    ],
  },
  {
    id: 'full-stack', title: 'Full-Stack Web Developer', topic: 'web_dev',
    description: 'Learn the browser first, then connect accessible interfaces to a tested server and persistent data.',
    steps: [
      { id: 'web-foundations', title: 'HTML, CSS and accessible layouts', skills: ['HTML', 'CSS'], prerequisites: [], hours: 40,
        project: 'Build a responsive study timetable with semantic HTML, keyboard navigation and clear focus states.',
        milestone: 'The timetable works on a phone and with a keyboard, with labelled controls.', resources: [mdn] },
      { id: 'javascript', title: 'JavaScript and browser fundamentals', skills: ['JavaScript'], prerequisites: ['web-foundations'], hours: 55,
        project: 'Add editable tasks, validation and browser persistence to your timetable. Handle malformed saved data.',
        milestone: 'Explain events, arrays, async operations and error handling in your own code.', resources: [mdn] },
      { id: 'frontend-app', title: 'Component-based frontend development', skills: ['React', 'TypeScript'], prerequisites: ['javascript'], hours: 55,
        project: 'Rebuild the task interface with typed components, routes, loading states and tests.',
        milestone: 'Separate state, rendering and data access; test a complete user journey.', resources: [mdn] },
      { id: 'server-data', title: 'Server, HTTP and database fundamentals', skills: ['Node.js', 'SQL'], prerequisites: ['frontend-app'], hours: 65,
        project: 'Build a local task API with persistent storage, input validation and tests. Use test data, not personal information.',
        milestone: 'Explain request/response handling, database queries, authorization and safe error responses.', resources: [node, mdn] },
      { id: 'web-capstone', title: 'Integrate and test a full-stack project', skills: ['Testing', 'Deployment'], prerequisites: ['server-data'], hours: 55,
        project: 'Connect your task interface to its API. Document setup, test failures and review accessibility and security before deployment.',
        milestone: 'A new user can complete a task flow and a developer can run the project from your README.', resources: [node, mdn] },
    ],
  },
]
