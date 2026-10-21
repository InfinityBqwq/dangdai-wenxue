import './data/store' // 必须最先：副作用引入接通 window.DATA / window.APP_CONFIG，Shell 初始化依赖
import './styles/tokens.css'
import './styles/shell.css'
import ReactDOM from 'react-dom/client'
import App from './App'

// 勿加 React.StrictMode：引擎为命令式挂载，dev 双调用会二次初始化（见任务约定）
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
