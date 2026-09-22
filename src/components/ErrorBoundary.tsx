import { Component } from "react";
import type { ReactNode } from "react";

interface Props { children:ReactNode; fallback?:(reset:()=>void)=>ReactNode; }
interface State { hasError:boolean; }

// Catches any uncaught error (render, lifecycle, or effects) anywhere below it.
// Reusable so both the app-wide boundary (main.tsx) and a narrower boundary
// around one risky subtree (e.g. TaskModal, so a bad task object only closes
// the modal instead of blanking the whole app) share the same recovery logic
// instead of each hand-rolling its own.
export class ErrorBoundary extends Component<Props,State> {
  constructor(props:Props){
    super(props);
    this.state={hasError:false};
  }
  static getDerivedStateFromError(){
    return {hasError:true};
  }
  componentDidCatch(error:unknown){
    console.error(error);
  }
  reset=()=>{this.setState({hasError:false});};
  render(){
    if(this.state.hasError){
      if(this.props.fallback)return this.props.fallback(this.reset);
      return (
        <div style={{minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:24,fontFamily:"'DM Mono', monospace",textAlign:"center",background:"#0a0a0a",color:"#cccccc"}}>
          <div style={{fontSize:18}}>Something went wrong.</div>
          <div style={{fontSize:13,color:"#7c7c7c"}}>Your data is safe -- reloading should fix it.</div>
          <button onClick={()=>window.location.reload()} style={{background:"#ffffff",color:"#000",border:"none",borderRadius:10,padding:"10px 20px",fontSize:14,fontFamily:"inherit",cursor:"pointer"}}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
