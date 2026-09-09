"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BellRingIcon, CircleCheckIcon, Clock3Icon, RefreshCwIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Status = "pending" | "processing" | "sent" | "failed"
type Notification = { id:string; eventType:string; aggregateType:string; aggregateId:string; recipient:string; subject:string; status:Status; attempts:number; nextAttemptAt:string|null; sentAt:string|null; lastErrorCode:string|null; createdAt:string }
const eventLabels:Record<string,string>={order_submitted:"주문 접수",shipment_created:"출고 생성",settlement_finalized:"정산 마감"}
const statusLabels:Record<Status,string>={pending:"대기",processing:"처리 중",sent:"발송 완료",failed:"발송 실패"}

async function csrf(){const response=await fetch("/api/auth/csrf",{credentials:"same-origin"});if(!response.ok)throw new Error("보안 토큰을 준비하지 못했습니다.");return(await response.json() as {csrfToken:string}).csrfToken}

export default function NotificationsPage(){
  const[items,setItems]=useState<Notification[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(""),[message,setMessage]=useState("")
  const load=useCallback(async()=>{setLoading(true);const response=await fetch("/api/admin/notifications",{credentials:"same-origin"});if(!response.ok){setMessage("업무 알림 현황을 불러오지 못했습니다.");setLoading(false);return}setItems(await response.json() as Notification[]);setMessage("");setLoading(false)},[])
  useEffect(()=>{void load()},[load])
  const counts=useMemo(()=>items.reduce((result,item)=>({...result,[item.status]:result[item.status]+1}),{pending:0,processing:0,sent:0,failed:0}),[items])
  async function command(path:string,success:(result:{processed?:number})=>string){setBusy(path);setMessage("");try{const response=await fetch(path,{method:"POST",credentials:"same-origin",headers:{"x-csrf-token":await csrf()}});const result=await response.json().catch(()=>({})) as {processed?:number;message?:string};if(!response.ok)throw new Error(result.message??"알림 작업을 처리하지 못했습니다.");setMessage(success(result));await load()}catch(error){setMessage(error instanceof Error?error.message:"알림 작업 중 오류가 발생했습니다.")}finally{setBusy("")}}
  return <div className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">업무 알림</h1><p className="mt-1 text-sm text-muted-foreground">주문 접수·출고·정산 알림의 발송 상태와 실패 재처리를 관리합니다.</p></div><div className="flex gap-2"><Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCwIcon className={loading?"animate-spin":""}/>새로고침</Button><Button onClick={()=>void command("/api/admin/notifications/process",result=>result.processed?`${result.processed}건을 발송했습니다.`:"현재 발송 가능한 알림이 없거나 메일 전송 설정이 꺼져 있습니다.")} disabled={Boolean(busy)}><BellRingIcon/>대기 알림 처리</Button></div></div>
  {message&&<div role="status" className="rounded-md border bg-muted/40 px-4 py-3 text-sm">{message}</div>}
  <section className="grid gap-3 sm:grid-cols-3"><Metric label="발송 대기" value={counts.pending+counts.processing} icon={Clock3Icon}/><Metric label="발송 완료" value={counts.sent} icon={CircleCheckIcon}/><Metric label="발송 실패" value={counts.failed} icon={TriangleAlertIcon}/></section>
  <Card><CardHeader><CardTitle>최근 알림</CardTitle><CardDescription>최근 200건의 수신자·재시도 횟수·처리 결과입니다.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>생성 일시</TableHead><TableHead>업무</TableHead><TableHead>수신자</TableHead><TableHead>제목</TableHead><TableHead>상태</TableHead><TableHead>시도</TableHead><TableHead className="text-right">작업</TableHead></TableRow></TableHeader><TableBody>{items.map(item=><TableRow key={item.id}><TableCell className="whitespace-nowrap text-xs">{new Date(item.createdAt).toLocaleString("ko-KR")}</TableCell><TableCell><Badge variant="outline">{eventLabels[item.eventType]??item.eventType}</Badge></TableCell><TableCell className="text-xs">{item.recipient}</TableCell><TableCell><strong className="text-sm">{item.subject}</strong>{item.lastErrorCode&&<p className="text-xs text-destructive">{item.lastErrorCode}</p>}</TableCell><TableCell><Badge variant={item.status==="failed"?"destructive":item.status==="sent"?"secondary":"outline"}>{statusLabels[item.status]}</Badge></TableCell><TableCell className="tabular-nums">{item.attempts}/8</TableCell><TableCell className="text-right">{item.status==="failed"&&<Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={()=>void command(`/api/admin/notifications/${item.id}/retry`,()=>"실패 알림을 발송 대기로 되돌렸습니다.")}><RotateCcwIcon/>재시도</Button>}</TableCell></TableRow>)}{!items.length&&<TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">업무 알림 기록이 없습니다.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></div>
}

function Metric({label,value,icon:Icon}:{label:string;value:number;icon:typeof Clock3Icon}){return <Card size="sm"><CardHeader className="grid grid-cols-[1fr_auto]"><CardDescription>{label}</CardDescription><span className="row-span-2 grid size-8 place-items-center rounded-md bg-muted"><Icon className="size-4"/></span><CardTitle className="text-xl tabular-nums">{value.toLocaleString("ko-KR")}건</CardTitle></CardHeader></Card>}
