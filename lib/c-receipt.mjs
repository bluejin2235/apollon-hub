import {randomBytes,randomUUID,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {QUESTION} from './lab.mjs';
const TTL=30*60*1000;
function key(){const k=process.env.LUNA_LAB_C_RECEIPT_KEY;if(!/^[a-f0-9]{64}$/.test(k??''))throw Error('receiver_not_configured');return Buffer.from(k,'hex');}
export function seal(data){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);const enc=Buffer.concat([c.update(brotliCompressSync(Buffer.from(JSON.stringify(data)))),c.final()]);return Buffer.concat([iv,c.getAuthTag(),enc]).toString('base64url');}
export function unseal(value,type){if(typeof value!=='string'||value.length>16000)throw Error('invalid_receipt');const b=Buffer.from(value,'base64url');const d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));const raw=brotliDecompressSync(Buffer.concat([d.update(b.subarray(28)),d.final()]),{maxOutputLength:1000000});const o=JSON.parse(raw.toString());if(o.type!==type||o.expires_at<Date.now())throw Error('expired_receipt');return o;}
export function createJob(){const job={type:'job',request_id:randomUUID(),question:QUESTION,created_at:Date.now(),expires_at:Date.now()+TTL};return {...job,token:seal(job)};}
export function receive(job,answer){if(typeof answer!=='string'||!answer.trim()||Buffer.byteLength(answer)>200000)throw Error('invalid_answer');const receipt={type:'receipt',request_id:job.request_id,question:job.question,received_at:new Date().toISOString(),answer,sha256:createHash('sha256').update(answer).digest('hex'),characters:[...answer].length,expires_at:Date.now()+TTL};const token=seal(receipt);if(token.length>12000)throw Error('receipt_url_too_large');return {receipt,token};}
