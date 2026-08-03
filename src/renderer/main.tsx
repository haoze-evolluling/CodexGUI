import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TrelloBoardWindow } from './components/TrelloBoardWindow';
import './style.css';

const isTrelloWindow = new URLSearchParams(window.location.search).get('window') === 'trello';
createRoot(document.getElementById('root')!).render(isTrelloWindow ? <TrelloBoardWindow /> : <App />);
