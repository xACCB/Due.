import { describe, it, expect } from "vitest";
import { endedPeriods, buildRecap, newRecaps, mergeRecaps, recapMessage, RECAP_LIMITS } from "./recaps";
import type { Recap, RecapTask } from "./recaps";

const at=(iso:string,time="12:00")=>new Date(`${iso}T${time}:00`).getTime();
const task=(over:Partial<RecapTask>):RecapTask=>({title:"Task",subject:"",dueDate:"",dueTime:"",...over});

describe("endedPeriods", () => {
  // Saturday 3 October 2026.
  it("on the first run covers the latest day, week, month and year", () => {
    expect(endedPeriods(null,"2026-10-03",0)).toEqual([
      {period:"day",start:"2026-10-02",end:"2026-10-02"},
      {period:"week",start:"2026-09-20",end:"2026-09-26"},
      {period:"month",start:"2026-09-01",end:"2026-09-30"},
      {period:"year",start:"2025-01-01",end:"2025-12-31"},
    ]);
  });
  it("honors the week start", () => {
    const week=endedPeriods(null,"2026-10-03",1).find(p=>p.period==="week");
    expect(week).toEqual({period:"week",start:"2026-09-21",end:"2026-09-27"});
  });
  it("is empty when already checked today", () => {
    expect(endedPeriods("2026-10-03","2026-10-03",0)).toEqual([]);
    expect(endedPeriods("2026-10-04","2026-10-03",0)).toEqual([]);
  });
  it("the next day adds only the day that just ended", () => {
    expect(endedPeriods("2026-10-02","2026-10-03",0)).toEqual([{period:"day",start:"2026-10-02",end:"2026-10-02"}]);
  });
  it("adds the week when it ends, and the month when it ends", () => {
    // Sunday 4 October: the week of Sep 27 to Oct 3 just ended.
    expect(endedPeriods("2026-10-03","2026-10-04",0)).toEqual([
      {period:"day",start:"2026-10-03",end:"2026-10-03"},
      {period:"week",start:"2026-09-27",end:"2026-10-03"},
    ]);
    expect(endedPeriods("2026-10-31","2026-11-01",0).map(p=>p.period)).toEqual(["day","week","month"]);
    expect(endedPeriods("2026-12-31","2027-01-01",0).map(p=>p.period)).toEqual(["day","month","year"]);
  });
  it("catches up on at most a week of days after a long absence", () => {
    const days=endedPeriods("2026-08-01","2026-10-03",0).filter(p=>p.period==="day");
    expect(days).toHaveLength(RECAP_LIMITS.days);
    expect(days[0].start).toBe("2026-09-26");
    expect(days[days.length-1].start).toBe("2026-10-02");
  });
});

describe("buildRecap", () => {
  const day={period:"day" as const,start:"2026-10-02",end:"2026-10-02"};
  it("is null when nothing happened", () => {
    expect(buildRecap([task({completedAt:at("2026-10-01")})],day)).toBeNull();
  });
  it("counts finished tasks, time, on-time and the busiest subject", () => {
    const r=buildRecap([
      task({title:"B",subject:"Math",dueDate:"2026-10-02",completedAt:at("2026-10-02","15:00")}),
      task({title:"A",subject:"Math",dueDate:"2026-10-01",completedAt:at("2026-10-02","09:00")}),
      task({title:"C",subject:"Art",completedAt:at("2026-10-02","23:59")}),
      task({title:"Other day",completedAt:at("2026-10-03","00:00")}),
      task({title:"Open",sessions:[{mins:25,at:at("2026-10-02")},{mins:10,at:at("2026-10-01")}]}),
    ],day)!;
    expect(r).toMatchObject({id:"recap-day-2026-10-02",finished:3,mins:25,dated:2,onTime:1,busiest:"Math",read:false});
    expect(r.titles).toEqual(["A","B","C"]);
  });
  it("treats a due time as the deadline", () => {
    const r=buildRecap([task({dueDate:"2026-10-02",dueTime:"10:00",completedAt:at("2026-10-02","10:30")})],day)!;
    expect(r).toMatchObject({dated:1,onTime:0});
  });
  it("still sends a recap for time worked with nothing finished", () => {
    expect(buildRecap([task({sessions:[{mins:40,at:at("2026-10-02")}]})],day)).toMatchObject({finished:0,mins:40});
  });
  it("caps the titles it keeps", () => {
    const many=Array.from({length:RECAP_LIMITS.titles+5},(_,i)=>task({title:`T${i}`,completedAt:at("2026-10-02")+i}));
    const r=buildRecap(many,day)!;
    expect(r.finished).toBe(RECAP_LIMITS.titles+5);
    expect(r.titles).toHaveLength(RECAP_LIMITS.titles);
  });
});

describe("newRecaps", () => {
  it("skips periods with nothing in them", () => {
    const got=newRecaps([task({completedAt:at("2026-10-02")})],null,"2026-10-03",0);
    expect(got.map(r=>r.id)).toEqual(["recap-day-2026-10-02"]);
  });
});

describe("mergeRecaps", () => {
  const r=(id:string,period:Recap["period"],end:string,read=false):Recap=>({id,period,start:end,end,finished:1,mins:0,dated:0,onTime:0,busiest:null,titles:["x"],read});
  it("puts the newest first, longer periods above shorter on the same day", () => {
    const out=mergeRecaps([r("d1","day","2026-10-01")],[r("d3","day","2026-10-03"),r("w","week","2026-10-03")]);
    expect(out.map(x=>x.id)).toEqual(["w","d3","d1"]);
  });
  it("keeps the stored copy when an id repeats", () => {
    const out=mergeRecaps([r("d1","day","2026-10-01",true)],[r("d1","day","2026-10-01")]);
    expect(out).toHaveLength(1);
    expect(out[0].read).toBe(true);
  });
  it("drops the oldest past the cap", () => {
    const many=Array.from({length:RECAP_LIMITS.kept+3},(_,i)=>r(`d${i}`,"day",`2026-${String(1+Math.floor(i/28)).padStart(2,"0")}-${String(1+i%28).padStart(2,"0")}`));
    const out=mergeRecaps([],many);
    expect(out).toHaveLength(RECAP_LIMITS.kept);
    expect(out.some(x=>x.id==="d0")).toBe(false);
  });
});

describe("recapMessage", () => {
  const base:Recap={id:"recap-day-2026-10-02",period:"day",start:"2026-10-02",end:"2026-10-02",finished:3,mins:80,dated:2,onTime:2,busiest:"Math",titles:["A","B"],read:false};
  it("writes the numbers as sentences", () => {
    const m=recapMessage(base);
    expect(m.kind).toBe("Daily recap");
    expect(m.date).toBe("2026-10-02");
    expect(m.description).toBe("You finished 3 tasks and spent 1h 20m working. All 2 with a due date were on time. Your busiest subject was Math.");
    expect(m.list).toEqual(["A","B","and 1 more"]);
  });
  it("handles one task, lateness and time only", () => {
    expect(recapMessage({...base,finished:1,mins:0,dated:1,onTime:0,busiest:null,titles:["A"]}).description)
      .toBe("You finished 1 task. The one with a due date was late.");
    expect(recapMessage({...base,dated:3,onTime:1}).description).toContain("1 of the 3 with a due date were on time.");
    const idle=recapMessage({...base,finished:0,mins:40,dated:0,onTime:0,busiest:null,titles:[]});
    expect(idle.description).toBe("You spent 40m working, with no tasks finished.");
    expect(idle.list).toBeUndefined();
  });
  it("names the period in the headline", () => {
    expect(recapMessage({...base,period:"week",start:"2026-09-27",end:"2026-10-03"}).headline).toBe("Weekly recap");
    expect(recapMessage({...base,period:"year",start:"2025-01-01",end:"2025-12-31"}).headline).toBe("2025 recap");
  });
});
