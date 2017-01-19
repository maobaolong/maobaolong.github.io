---
title: Android so文件反编译
date: 2016-08-14 21:57:33
categories: NDK
tags: 
    - objdump
    - ida pro
---

# objdump

其中测试代码为hello.s

```
	.arch armv5te
	.fpu softvfp
	.file	"hello.c"
	.section	.rodata //只读数据段
	.align	2 //4字节对齐
.LC0:
	.ascii	"hello ARM!\000" //字符串，一定要以\0结尾，不然他会一直读取直到\0才结束
.LC1:
	.ascii	"hello world!\0"
.LC2:
	.ascii	"ha!"

	.text //指令段
	.align	2
	.global	main //申明为全局
	.type	main, %function //类型为函数
main:
	@ args = 0, pretend = 0, frame = 8
	@ frame_needed = 1, uses_anonymous_args = 0
	stmfd	sp!, {fp, lr} //将fp,lr压栈
	add	fp, sp, #4 @初始化fp寄存器，设置栈帧
	sub	sp, sp, #8 @开辟栈控件
	str	r0, [fp, #-8] @保存第一个参数
	str	r1, [fp, #-12] @保存第二个参数
	ldr	r3, .L3 @从l3标号加载一个字地址
.LPIC0:
	add r3, pc, r3 @把字符串的相对位置+pc地址就是这个字符串的绝对地址 
	mov	r0, r3 @设置第一个参数
	bl	puts(PLT) @调用puts函数
	ldr	r3, .L3+4
.LPIC1:
	add	r3, pc, r3
	mov	r0, r3
	bl	puts(PLT)
	ldr	r3, .L3+8
.LPIC2:
	add	r3, pc, r3
	mov	r0, r3
	bl	puts(PLT)
	mov	r3, #0
	mov	r0, r3
	sub	sp, fp, #4
	@ sp needed
	ldmfd	sp!, {fp, pc}

.L3:
	.word	.LC0-(.LPIC0+8)
	.word	.LC1-(.LPIC1+8)
	.word	.LC2-(.LPIC2+8)
	.size	main, .-main
	.ident	"GCC: (GNU) 4.9 20150123 (prerelease)"
	.section	.note.GNU-stack,"",%progbits
```

他是ndk中提供的一个工具

```
arm-linux-androideabi-objdump -S hello
```

```
hello:     file format elf32-littlearm


Disassembly of section .plt:

00008220 <puts@plt-0x14>:
    8220:	e52de004 	push	{lr}		; (str lr, [sp, #-4]!)
    8224:	e59fe004 	ldr	lr, [pc, #4]	; 8230 <puts@plt-0x4>
    8228:	e08fe00e 	add	lr, pc, lr
    822c:	e5bef008 	ldr	pc, [lr, #8]!
    8230:	00001db8 			; <UNDEFINED> instruction: 0x00001db8

00008234 <puts@plt>:
    8234:	e28fc600 	add	ip, pc, #0, 12
    8238:	e28cca01 	add	ip, ip, #4096	; 0x1000
    823c:	e5bcfdb8 	ldr	pc, [ip, #3512]!	; 0xdb8

00008240 <__libc_init@plt>:
    8240:	e28fc600 	add	ip, pc, #0, 12
    8244:	e28cca01 	add	ip, ip, #4096	; 0x1000
    8248:	e5bcfdb0 	ldr	pc, [ip, #3504]!	; 0xdb0

0000824c <__cxa_atexit@plt>:
    824c:	e28fc600 	add	ip, pc, #0, 12
    8250:	e28cca01 	add	ip, ip, #4096	; 0x1000
    8254:	e5bcfda8 	ldr	pc, [ip, #3496]!	; 0xda8

Disassembly of section .text:

00008258 <main>:
    8258:	e92d4800 	push	{fp, lr}
    825c:	e28db004 	add	fp, sp, #4
    8260:	e24dd008 	sub	sp, sp, #8
    8264:	e50b0008 	str	r0, [fp, #-8]
    8268:	e50b100c 	str	r1, [fp, #-12]
    826c:	e59f3038 	ldr	r3, [pc, #56]	; 82ac <main+0x54>
    8270:	e08f3003 	add	r3, pc, r3
    8274:	e1a00003 	mov	r0, r3
    8278:	ebffffed 	bl	8234 <puts@plt>
    827c:	e59f302c 	ldr	r3, [pc, #44]	; 82b0 <main+0x58>
    8280:	e08f3003 	add	r3, pc, r3
    8284:	e1a00003 	mov	r0, r3
    8288:	ebffffe9 	bl	8234 <puts@plt>
    828c:	e59f3020 	ldr	r3, [pc, #32]	; 82b4 <main+0x5c>
    8290:	e08f3003 	add	r3, pc, r3
    8294:	e1a00003 	mov	r0, r3
    8298:	ebffffe5 	bl	8234 <puts@plt>
    829c:	e3a03000 	mov	r3, #0
    82a0:	e1a00003 	mov	r0, r3
    82a4:	e24bd004 	sub	sp, fp, #4
    82a8:	e8bd8800 	pop	{fp, pc}
    82ac:	000000e8 	.word	0x000000e8
    82b0:	000000e3 	.word	0x000000e3
    82b4:	000000e0 	.word	0x000000e0

000082b8 <__atexit_handler_wrapper>:
    82b8:	e3500000 	cmp	r0, #0
    82bc:	012fff1e 	bxeq	lr
    82c0:	e12fff10 	bx	r0

000082c4 <_start>:
    82c4:	e59fc05c 	ldr	ip, [pc, #92]	; 8328 <_start+0x64>
    82c8:	e59f205c 	ldr	r2, [pc, #92]	; 832c <_start+0x68>
    82cc:	e92d4800 	push	{fp, lr}
    82d0:	e08fc00c 	add	ip, pc, ip
    82d4:	e28db004 	add	fp, sp, #4
    82d8:	e59f3050 	ldr	r3, [pc, #80]	; 8330 <_start+0x6c>
    82dc:	e24dd010 	sub	sp, sp, #16
    82e0:	e59f104c 	ldr	r1, [pc, #76]	; 8334 <_start+0x70>
    82e4:	e79c2002 	ldr	r2, [ip, r2]
    82e8:	e50b2014 	str	r2, [fp, #-20]	; 0xffffffec
    82ec:	e59f2044 	ldr	r2, [pc, #68]	; 8338 <_start+0x74>
    82f0:	e79c3003 	ldr	r3, [ip, r3]
    82f4:	e50b3010 	str	r3, [fp, #-16]
    82f8:	e59f303c 	ldr	r3, [pc, #60]	; 833c <_start+0x78>
    82fc:	e79c1001 	ldr	r1, [ip, r1]
    8300:	e50b100c 	str	r1, [fp, #-12]
    8304:	e79c2002 	ldr	r2, [ip, r2]
    8308:	e50b2008 	str	r2, [fp, #-8]
    830c:	e28b0004 	add	r0, fp, #4
    8310:	e79c2003 	ldr	r2, [ip, r3]
    8314:	e3a01000 	mov	r1, #0
    8318:	e24b3014 	sub	r3, fp, #20
    831c:	ebffffc7 	bl	8240 <__libc_init@plt>
    8320:	e24bd004 	sub	sp, fp, #4
    8324:	e8bd8800 	pop	{fp, pc}
    8328:	00001d10 	.word	0x00001d10
    832c:	ffffffec 	.word	0xffffffec
    8330:	fffffff0 	.word	0xfffffff0
    8334:	fffffff4 	.word	0xfffffff4
    8338:	fffffff8 	.word	0xfffffff8
    833c:	fffffffc 	.word	0xfffffffc

00008340 <atexit>:
    8340:	e1a01000 	mov	r1, r0
    8344:	e59f200c 	ldr	r2, [pc, #12]	; 8358 <atexit+0x18>
    8348:	e59f000c 	ldr	r0, [pc, #12]	; 835c <atexit+0x1c>
    834c:	e08f2002 	add	r2, pc, r2
    8350:	e08f0000 	add	r0, pc, r0
    8354:	eaffffbc 	b	824c <__cxa_atexit@plt>
    8358:	00001cac 	.word	0x00001cac
    835c:	ffffff60 	.word	0xffffff60
```

我们可以从上面看到他用汇编显示了这个文件的内容

plt:主要用于函数重定位

text:程序代码段

# ida pro

可以说是最强大的反汇编器，具体使用方法时将so拖入ida可以看见下面代码

```
.text:00008258                 STMFD   SP!, {R11,LR}
.text:0000825C                 ADD     R11, SP, #4
.text:00008260                 SUB     SP, SP, #8
.text:00008264                 STR     R0, [R11,#var_8]
.text:00008268                 STR     R1, [R11,#var_C]
.text:0000826C                 LDR     R3, =(aHelloArm - 0x8278)
.text:00008270                 ADD     R3, PC, R3      ; "hello ARM!"
.text:00008274                 MOV     R0, R3          ; s
.text:00008278                 BL      puts
.text:0000827C                 LDR     R3, =(aHelloWorld - 0x8288)
.text:00008280                 ADD     R3, PC, R3      ; "hello world!"
.text:00008284                 MOV     R0, R3          ; s
.text:00008288                 BL      puts
.text:0000828C                 LDR     R3, =(aHa - 0x8298)
.text:00008290                 ADD     R3, PC, R3      ; "ha!"
.text:00008294                 MOV     R0, R3          ; s
.text:00008298                 BL      puts
.text:0000829C                 MOV     R3, #0
.text:000082A0                 MOV     R0, R3
.text:000082A4                 SUB     SP, R11, #4
.text:000082A8                 LDMFD   SP!, {R11,PC}
```

我们可以看到反汇编的代码和我们上面写的基本差不多。那下面我们就一一看看常用的反编译代码片段

## for















