---
title: ARM汇编
date: 2016-08-10 17:18:12
categories: ARM
tags: 
    - ARM汇编
---

# ARM汇编程序结构

Android中使用的ARM汇编是GUN ARM汇编，用到的编译器是GAS(GUN assembler)他有一套自己的语法，具体的可以参考[https://sourceware.org/binutils/docs/as/index.html](https://sourceware.org/binutils/docs/as/index.html)

# 解析ARM汇编

```assembly
	.arch armv5te @处理器架构
	.fpu softvfp @协处理类型
	.eabi_attribute 20, 1 @接口属性
	.eabi_attribute 21, 1
	.eabi_attribute 23, 3
	.eabi_attribute 24, 1
	.eabi_attribute 25, 1
	.eabi_attribute 26, 2
	.eabi_attribute 30, 6
	.eabi_attribute 34, 0
	.eabi_attribute 18, 4
	.file	"hello.c" @源文件名
	.global	nums @全局符号nums
	.data
	.align	2 @对齐方式2^2=4字节=32位
	.type	nums, %object @类型为对象
	.size	nums, 20 @20个字节，5个int值
nums:
	.word	1
	.word	2
	.word	3
	.word	4
	.word	5
	.text
	.align	2
	.global	for0
	.type	for0, %function
for0:
	@ args = 0, pretend = 0, frame = 16
	@ frame_needed = 1, uses_anonymous_args = 0
	@ link register save eliminated.
	str	fp, [sp, #-4]!
	add	fp, sp, #0
	sub	sp, sp, #20
	str	r0, [fp, #-16]
	mov	r3, #0
	str	r3, [fp, #-8]
	mov	r3, #0
	str	r3, [fp, #-12]
	mov	r3, #0
	str	r3, [fp, #-8]
	b	.L2
.L3:
	ldr	r2, [fp, #-12]
	ldr	r3, [fp, #-8]
	add	r3, r2, r3
	str	r3, [fp, #-12]
	ldr	r3, [fp, #-8]
	add	r3, r3, #1
	str	r3, [fp, #-8]
.L2:
	ldr	r2, [fp, #-8]
	ldr	r3, [fp, #-16]
	cmp	r2, r3
	blt	.L3
	ldr	r3, [fp, #-12]
	mov	r0, r3
	sub	sp, fp, #0
	@ sp needed
	ldr	fp, [sp], #4
	bx	lr
	.size	for0, .-for0
	.align	2
	.global	for1
	.type	for1, %function
for1:
	@ args = 0, pretend = 0, frame = 16
	@ frame_needed = 1, uses_anonymous_args = 0
	@ link register save eliminated.
	str	fp, [sp, #-4]!
	add	fp, sp, #0
	sub	sp, sp, #20
	str	r0, [fp, #-16]
	mov	r3, #0
	str	r3, [fp, #-8]
	mov	r3, #0
	str	r3, [fp, #-12]
	mov	r3, #0
	str	r3, [fp, #-8]
	b	.L6
.L7:
	ldr	r3, [fp, #-8]
	mov	r3, r3, asl #1
	ldr	r2, [fp, #-12]
	add	r3, r2, r3
	str	r3, [fp, #-12]
	ldr	r3, [fp, #-8]
	add	r3, r3, #1
	str	r3, [fp, #-8]
.L6:
	ldr	r2, [fp, #-8]
	ldr	r3, [fp, #-16]
	cmp	r2, r3
	blt	.L7
	ldr	r3, [fp, #-12]
	mov	r0, r3
	sub	sp, fp, #0
	@ sp needed
	ldr	fp, [sp], #4
	bx	lr
	.size	for1, .-for1
	.align	2
	.global	for2
	.type	for2, %function
for2:
	@ args = 0, pretend = 0, frame = 16
	@ frame_needed = 1, uses_anonymous_args = 0
	@ link register save eliminated.
	str	fp, [sp, #-4]!
	add	fp, sp, #0
	sub	sp, sp, #20
	str	r0, [fp, #-16]
	ldr	r1, .L13
.LPIC0:
	add	r1, pc, r1
	mov	r3, #0
	str	r3, [fp, #-8]
	mov	r3, #0
	str	r3, [fp, #-12]
	mov	r3, #0
	str	r3, [fp, #-8]
	b	.L10
.L11:
	ldr	r3, [fp, #-8]
	ldr	r2, [fp, #-8]
	mul	r2, r3, r2
	ldr	r3, [fp, #-16]
	sub	r0, r3, #1
	ldr	r3, .L13+4
	ldr	r3, [r1, r3]
	ldr	r3, [r3, r0, asl #2]
	add	r3, r2, r3
	ldr	r2, [fp, #-12]
	add	r3, r2, r3
	str	r3, [fp, #-12]
	ldr	r3, [fp, #-8]
	add	r3, r3, #1
	str	r3, [fp, #-8]
.L10:
	ldr	r2, [fp, #-8]
	ldr	r3, [fp, #-16]
	cmp	r2, r3
	blt	.L11
	ldr	r3, [fp, #-12]
	mov	r0, r3
	sub	sp, fp, #0
	@ sp needed
	ldr	fp, [sp], #4
	bx	lr
.L14:
	.align	2
.L13:
	.word	_GLOBAL_OFFSET_TABLE_-(.LPIC0+8)
	.word	nums(GOT)
	.size	for2, .-for2
	.section	.rodata @声明只读数据段
	.align	2
.LC0: @标号LC0
	.ascii	"hello ARM!\000" @声明字符串
	.align	2
.LC1:
	.ascii	"for0%d\012\000"
	.align	2
.LC2:
	.ascii	"for1%d\012\000"
	.align	2
.LC3:
	.ascii	"for2%d\012\000"
	.text @代码段
	.align	2
	.global	main @全局符号，main
	.type	main, %function @main符号的类型为函数
main:
	@ args = 0, pretend = 0, frame = 8
	@ frame_needed = 1, uses_anonymous_args = 0
	stmfd	sp!, {fp, lr} @将fp,lr寄存器入栈
	add	fp, sp, #4 @初始化fp寄存器，设置栈帧
	sub	sp, sp, #8 @开辟栈控件
	str	r0, [fp, #-8] @保存第一个参数
	str	r1, [fp, #-12] @保存第二个参数
	ldr	r3, .L17 @取标号L17处的内容，即“hello ARM!\n”
.LPIC1: @标号.LPIC1
	add	r3, pc, r3 @计算“hello ARM!\n”字符串的内存地址
	mov	r0, r3 @设置参数1
	bl	puts(PLT) @调用puts函数
	mov	r0, #5 @程序返回结果为0
	bl	for0(PLT) @调用函数for0
	mov	r2, r0 @for0的返回结果
	ldr	r3, .L17+4
.LPIC2:
	add	r3, pc, r3
	mov	r0, r3
	mov	r1, r2
	bl	printf(PLT)
	mov	r0, #5
	bl	for1(PLT)
	mov	r2, r0
	ldr	r3, .L17+8
.LPIC3:
	add	r3, pc, r3
	mov	r0, r3
	mov	r1, r2
	bl	printf(PLT)
	mov	r0, #5
	bl	for2(PLT)
	mov	r2, r0
	ldr	r3, .L17+12
.LPIC4:
	add	r3, pc, r3
	mov	r0, r3
	mov	r1, r2
	bl	printf(PLT)
	mov	r3, #0
	mov	r0, r3
	sub	sp, fp, #4
	@ sp needed
	ldmfd	sp!, {fp, pc} @回复，fp的值，并将lr寄存器的值赋值给pc寄存器
.L18:
	.align	2
.L17:
	.word	.LC0-(.LPIC1+8)
	.word	.LC1-(.LPIC2+8)
	.word	.LC2-(.LPIC3+8)
	.word	.LC3-(.LPIC4+8)
	.size	main, .-main
	.ident	"GCC: (GNU) 4.9 20150123 (prerelease)"
	.section	.note.GNU-stack,"",%progbits

```

## 处理器架构定义

```
.arch armv5te @处理器架构
.fpu softvfp @协处理类型
.eabi_attribute 20, 1 @接口属性
.eabi_attribute 21, 1
.eabi_attribute 23, 3
.eabi_attribute 24, 1
.eabi_attribute 25, 1
.eabi_attribute 26, 2
.eabi_attribute 30, 6
.eabi_attribute 34, 0
.eabi_attribute 18, 4
```

这些指令定义了程序使用的处理器架构，协处理器类型，接口属性

armv5te:表示本程序的代码可以在armv5te及以上的架构处理器上运行，包括armv6,armv7-a

fpt:

​	softvfp:表示使用浮点运算库来模拟协处理运算。取值vfpv2,vfpv3

eabi_attribute：指定了接口属性(Embedded application binary interface,嵌入式应用二进制接口)是arm制订的一套接口规范，Android实现了这套规范

## 段定义

段都是很多年前的术语了，现在的高级语言基本上没有直接使用，而是由编译器字节生成的。

使用.section指令来定义

```
.section name [, "flags" [,%type [,flag_specifice_arguments]]]
```

name:段名

flags:段属性，读，写，可执行

type:段的类型，如：progbits表示段中包含数据，note表示包含的数据非程序本身使用

flag_specifice_arguments：指定平台相关的参数



我们上面定义三个段

.section	.rodata:定义只读段，属性采用默认值

.text:代码段

.section .note.GUN-stack,"",%progbits：定义了.note.GUN-stack段，他的作用是禁止生产可以执行堆栈，用来保护代码安全

## 注释

/* 多行注释 */

@单行注释

## 标号

在汇编中标号十分常见，当程序跳转时就是使用标号作为跳转目的地，汇编器在编译时会将标号转为地址，标号申明格式为：

```
<标号名>:
	代码...
```

```
for1:
	@ args = 0, pretend = 0, frame = 16
	@ frame_needed = 1, uses_anonymous_args = 0
	@ link register save eliminated.
	str	fp, [sp, #-4]!
	add	fp, sp, #0
	sub	sp, sp, #20
	str	r0, [fp, #-16]
	mov	r3, #0
	str	r3, [fp, #-8]
	mov	r3, #0
	str	r3, [fp, #-12]
	mov	r3, #0
	str	r3, [fp, #-8]
	b	.L6
```

## 汇编指令

程序中所有以“.”开头的指令都是汇编指令，他不属于ARM指令集。在GAS的文档[Assembler Directives](https://sourceware.org/binutils/docs/as/Pseudo-Ops.html#Pseudo-Ops)列出了所以得汇编指令

在上面的示例中我们使用到的汇编指令有：

.file:源文件名

.align:代码定制方式，后面的数值为2^次数放

.ascii:声明字符串

.global:声明全局符号。全局符号是指在本程序外可以访问的符号

.type：指定符号的类型。

​	.type	for0, %function表示for0是一个函数

.word：用来存放地址值

​	.word	.LC0-(.LPIC1+8)表示存放一个与地址无关的偏移量

.size:设置指定符号的大小

​	.size	for2, .-for2表示当前地址减去for2符号的地址即为整个for2函数的大小

.ident:编译器表示，没有实际用途，生成可执行程序后值被放到.comment段中

## 子程序间参数传递

自程序一般用来完成一个独立的功能，汇编中的函数声明如下：

```
.global 函数名
.type 函数,%function
函数名:
	<函数体>
```

```
.global myAdd
.type myAdd,%function
myAdd:
	add r0, r0, r1 @两个参数相加
	mov pc, lr @函数返回
```

在ARM汇编中参数传递规则:用R0-R3传递1-4个参数，如果超出用堆栈来传递，R0返回时并保存函数的返回值

# 寻址方式

通过一定的方法从给出的地址码寻找真实的操作数，叫寻址

## 立即寻址

最简单的一种寻址，只能做源操作数，为立即数(常量或常数)

mov r0, #888

mov r1,#0x888

## 寄存器寻址

操作数在寄存器中

mov r0,r1

## 寄存器移位寻址

arm特有的寻址方法，他和寄存器寻址差不多，只是在寻址前先对操作数移位，它共有下面5种

lsl:逻辑左移，低位补0

lsr:逻辑右移，高位补0

asr:算术右移，移位过程中符号不变，也就是源操作室为正数，移位后高位补0，负数补1

ror：循环右移，移位后移除的低位填入移除的高位

rrx:带扩展的循环右移，操作数右移一位，移位空出的高位用C标志(进位标志)的值填充

mov r0, r1, lsl #2

## 寄存器间接寻址

源操作寄存器里面给出的是操作数的地址指针，将源寄存器值作为地址，并取出真实值赋值给目的寄存器

ldr r0, [r1]

## 基址寻址

基址寄存器的值+偏移量在作为地址，取出来值。一般用于，数组，查表

ldr r0, [r1, #-4] @将r1寄存器的值-4作为地址，然后在取出改地址的值赋值给r0寄存器

## 多寄存器寻址

改指令最多可以完成16个通用寄存器值得传送

ldmia r0, {r1,r2,r3,r4}

ldm:数据加载指令，ia为指令后缀，表示每执行一次操作，r0寄存器的值自增1个字(arm中表示32的数值)

上述指令结果为：r1=[r0],r2=[r0+#4],r3=[r0+#8],r4=[r0+#12]

## 堆栈寻址

arm特有的寻址，有ldmfa/stmfa,ldmea/stmea,ldmfd/stmfd,ldmed/stmed。ldm，stm为指令前缀，表示多寄存器寻址。fa,ea,fd,ed为指令后缀

stmfd sp!, {r1-r7, lr} @将r1-r7,lr入栈。常用于调用子程序前的现场保护

ldmfd sp!, {r1-r7,lr} @数据出栈，数据一次放入r1-r7,lr。常用于子程序调用完毕，现在恢复

## 块拷贝寻址

连续地址数据在存储器从一个位置拷贝到另一位置。ldmia/stmia,ldmda/stmda,ldmid/stmid,ldmdb/stmdb

ldmia r0!, {r1-r3} @从r0寄存器指向的存储单元中读取3个字到r1-r3

stmia r0!, {r1-r3} @将存储器r1-r3的值一次存到r0寄存器指向的内存单元

## 相对寻址

以程序计数器pc的值为基址，指令中的地址作为偏移量，相加得到操作数的地址

bl loop

​	...



loop:

​	...

这里的跳转就是相对寻址

# arm指令集

## 指令格式

```
<opcode> {<cond>} {s}{.w|.n} <rd>,<rn>{,<operand2>}
```

opcode:指令助记符，mov,add

cond:指令执行条件，取值如下

| 条件助记符 | 标志位      | 含义            |
| ----- | -------- | ------------- |
| eq    | z=1      | 等于            |
| ne    | z=0      | 不等于          |
| cs/hs | c=1      | 无符号数大于或等于     |
| cc/lo | c=0      | 无符号数小于        |
| mi    | n=1      | 负数            |
| pl    | n=0      | 正数或0          |
| vs    | v=1      | 溢出            |
| vc    | v=0      | 没有溢出          |
| hi    | c=1,z=0  | 无符号数大于        |
| ls    | c=0，z=1  | 无符号数大于或等于     |
| ge    | n=v      | 有符号数大于        |
| lt    | n!=v     | 有符号大于         |
| gt    | z=0,n=v  | 有符号数大于        |
| le    | z=1，n!=v | 有符号数小于或等于     |
| al    | 任何       | 无条件执行(指令默认条件) |

s:指定这条指令是否影响CPSR寄存器的值，如：adds,subs

.w/.n:指令宽度说明符，armv6t2及更高版本的thumb代码中，部分指令的编码为16位，也可以是32位，正常情况下代码都是有效的，默认会生成16为，如果想要生成32位的编码，则需要在指令后面加.w说明符。无论是arm代码还是thumb(armv6t2或更高)代码，都可以使用.w。如果需要将指令汇编为16位编码，则需要添加.n说明符号

rd:目的寄存器

rn：为第一个操作数寄存器

operand2:第二个操作数，可以是立即数，寄存器，寄存器移位操作



mov r0, #2

add r1, r2, r3

sub r2, r3, r4, lsl #2

## 跳转指令

也称分支指令，作用是改变指令的执行流程，arm中有两个方式可以实现，使用跳转指令和直接赋值pc寄存器

### b

b{cond} label

满足条件就跳转到标号出，bne label,表示z=0时跳转到label处

### bl

bl{cond} label

带链接的跳转指令，如果条件满足，执行bl指令是，他先将当前指令的下调指令的地址拷贝到r14(lr)寄存器，然后跳转到label标号处，常用于子程序，在子程序末尾就可以使用mov pc,lr返回到主程序

### bx

带状态切换的跳转指令，如果条件满足，执行bx时，处理器会先判断rm的位[0]是否为1，如果为1则跳转时自动将cpsr寄存器的标志t置为1，并将目标地址出的代码解释为thumb代码来执行，即处理器切换到了thumb状态。反之rm的位[0]为0，则跳转时自动将cpsr寄存器t置为0，并将目标地址处的代码解释为arm代码执行

```assembly
	.code 32
	...
	add r0, thumbcode+1
	bx r0
thumbcode:
	.code 16
	...
```

### blx

带链接和状态切换的条状指令，就是bl和bx功能的结合，除了设置链接寄存器，还根据rm[0]的值来切换处理器状态

## 存储器访问指令

用于从存储器加载数据，存储数据到存储器，寄存器与存储器间数据交换

### ldr

从存储器加载到数据到寄存器中

```
ldr{type}{cond} rd,label

ldrd{type}{cond} rd,rd2,label
```

type：指定操作数的数据大小

| type | 含义                  |
| ---- | ------------------- |
| b    | 无符号字节(加载时0扩展为32位)   |
| sb   | 有符号字节(加载时符号位扩展为32位) |
| h    | 无符号半字(0扩展32位)       |
| sh   | 有符号半字(符号位扩展为32位)    |

cond：执行条件，取值为上面的表

rd:加载完要存储到的寄存器

label:要读取的内存地址，有三种表示方法

​	直接偏移量:ldr r8,[r9,#04]、ldr r8,[r9],#04

​	寄存器偏移:ldr r8,[r9,r10,#04]

ldrd:一次加载双字数据，到r2,rd2寄存器中

ldrd r0,r1,label12 @从标号label12指向的内存地址加载两个字

## str

用于存储数据到指定的存储单元中

str{type}{cond} rd,label

strd{cond} rd,rd2,label

str r0, [r2,#04] @将r0寄存器的数据存储到r2+4地址的值

## ldm

可以从指定的存储单元加载多个数据到一个寄存器列表

ldm{add_mode}{cond} rn{!} reglist

add_mode:

| addr_mode | 含义                                |
| --------- | --------------------------------- |
| ia        | increase after,基址寄存器在执行指令之后增加，默认值 |
| ib        | increase before,之间增加(仅arm支持)      |
| da        | decrease after,之后减少(仅arm支持)       |
| db        | decrease before,之间减少              |
| fd        | 满递减堆栈。高地址到低地址，堆栈指针指向最后一个入栈的有效数据项  |
| fa        | 满递增堆栈。低地址到高地址，堆栈指针指向下一个要存放的空地址    |
| ed        | 空递减堆栈。高地址到低地址                     |
| ea        | 空递增堆栈。低地址到高地址                     |

rn为基地存储器，

!可选后缀：将最终地址协会rn寄存器

reglist:用来存储数据的寄存器列表，用大括号括起来，可以用-表示多个连续的寄存器，如果不是连续的需要写出来

ldm R0!, {r1-r3} @依次加载r0指向的存储单元的数据到r1,r2,r3

## stm

将一个寄存器列表数据存储到指定的存储单元

stm{addr_mode}{cond} rn{!} reglist

stmdb r1!, {r3-r6, r11} @将r3-r6,r11寄存器的内容存储到r1指向的存储单元

stmfd sp!, {r3-r7} @r3-r7寄存器压入堆栈，等价于stmdb sp!, {r3-r7}

## push

将寄存器的值推入满减堆栈

push{cond} reglist

push {r0, r4-r7} @r0,r4-r7寄存器内容入栈

## pop

从满递减堆栈中弹出数据到寄存器

pop{cond} reglist

pop {r0, r4-r7} @将r0,r4-r7寄存器从堆栈中弹出

## swp

寄存器之间交换数据

swp{b}{cond} rd, rm, [rn]

b：可选，交换字节，否则交换32位字

rd:

//TODO

## 数据处理指令

包括传送，算术，逻辑，比较。除了比较指令其他的都可以选用s后缀，来决定是否影响标志位

### mov

将8位立即数或寄存器的内容传送到目标寄存器

mov{cond}{s} rd,operand2

mov r0, #8 @r0=8

mov r1, r0 @r1=r0

movs r2, r1, lsl #2 @r2=r1*4，影响状态标志位

### mvn

将8位的立即数或寄存器的值按位取反后传递到目标

mvn r0, #0xff @r0=ffffff00

mvn r1, r2 @将寄存器数据取反后存入r1

### add

加法

add r0, r1 #2 @r0=r1+2

adds r0, r1,r2 @r0=r1+r2,影响标志位

add r0,r1,lsl #3 @r0=r1*8

### adc

带进位加法指令，功能为rn+operand2+cpsr寄存器c条件标志位的值，存入rd

adc{cond}{s} rd,rn,operand2

add r0,r0,r2

add r1,r1,r3 @两条指令完成64位加法，r1,r0=r1,r0+r3,r2

### sub

减法，rn-operand2值，结果保存到rd

sub r0,r1,#4 @r0=r1-4

sub r0,r1,r2 @r0=r1-r2，影响标志位

### rsb

逆向减法指令，operand2-rn，结果保存到rd

rsb{cond}{s}rd,rn,opearand2

rsb r0,r1 #0x1234 @r0=0x1234-r1

rub r0,r1 @r0=-r1

#### sbc

带进位减法，rn-opearnad2,在减去cpsr寄存器c值

sbc{cond}{s} rd,rn,operand2

subs r0,r0,r2

sbc r1,r1,r3 @64位减法，r1,r0=r1,r0-r2,r3

### rsc

带进位逆向减法指令，operand2-rn-c=rd

rsc{cond} rd,rn,operand2

rsbs r2,r0,#0

rsc r3,r1,#0 @64为数取反，r3,r2=r1,r0

### mul

32位乘法，rm*rn，结果低32位保存到rd

mul{cond}{s} rd,rm ,rn

mum r0,r1,r2 @r0=r1*r2

muls r0,r2,r3 @r0=r2*r3,影响n和z

### mls

mls{cond}{s} rd,rm,rn,ra

rm寄存器的值*rn寄存器的值，然后在从ra寄存器的值中减去上一步的乘积

mls r0,r1,r2,r3 @r0=r3-r1*r2

### mla

mla{cond}{s} rd,rm,rn,ra

将rm*rn在加ra

mla r0,r1,r2,r3 @r0=r1*r2+r3

### umull

umull{cond}{s} rdLo,rdHi,rm,rn

将无符号rm寄存器的值和无符号寄存器rn的值相乘，然后将结果的低32位存入rdLo,高32位存入rdHi寄存器

umull r0,r1,r2,r3 @r1,r0=r2*r3

### umlal

umlal{cond}{s} rdLo,rdHi,rm,rn

将无符号rm寄存器的值和无符号寄存器rn的值相乘,然后将64位的结果与rdHi,rdLo组成的64位数相加，然后在按顺序放入寄存器

umlal r0,r1,r2,r3 @r1,r0=r2*r3+(r1,r0)

### smull

smull{cond}{s} rdLo,rdHi,rm,rn

将rm寄存器的值和寄存器rn的值做为有符号数相乘，结果低32位放入rdLo,高32位存入rdHi

smull r0,r1,r2,r3 @r1,r0=r2*r3

### smlal

将rm寄存器的值和寄存器rn的值做为有符号数相乘，然后将结果加上rdHi,rdLo组成的64位数，结果低32位放入rdLo,高32位存入rdHi

smlal r0,r1,r2,r3 @r1,r0=r2*r3+(r1,r0)

### smlad

smlad{cond}{s} rd,rm,rn,ra

将rm寄存器低半字节和rn寄存器低半字节相乘，然后将rm寄存器的高半字节和rn的高半字节相乘，最后将两个乘积//TODO

### smlsd

### sdiv

有符号除法指令

sdiv{cond}rd,rm,rn

sdiv r0,r1,r2 @r0=r1/r2

### udiv

无符号除法

udiv{cond} rd,rm,rn

udiv r0,r1,r2 @r0=r1/r2

### asr

asr{cond}{s} rd,rm,opearnd2

算术右移指令。rm寄存器算术右移opearnd2位，高位用符号位填充，结果保存到rd

asr r0,r1,#2

### and

逻辑与

and{cond}{s} rd,rn,operand2

and r0,r0,#1 @取r0得最低1位

### orr

逻辑或

orr{cond}{s} rd,rn,operand2

orr r0,r0,#0xf @保留r0低4位，其余位清0

### eor

异或

eor{cond}{s} rd,rn,opearnd2

eor r0,r1,r2 @r0=r1^r2

### bic

位清除指令。功能是讲operand2得值取反，然后与rn的值，结果保存到rd

bic{cond}{s} rd,rn,operand2

bic r0,r0,#0x0f @清除r0低4位

### lsl

逻辑左移，rm的值左移operand2,空位补0

lsl{cond}{s} rd,rm,operand2

lsl r0,r1,#2 @r0=r1*2^2

### lsr

逻辑右移指令。rm逻辑右移operand2位，空位补0

lsr{cond}{s} rd,rm,operand2

lsr r0,r1#2 @r0=r1/(2^2)

#### ror

循环右移，rm的值循环右移operand2位，右边移除的值放回左边

ror{cond}{s} rd,rm,operand2

ror r1,r1,#1

### rrx

带扩展位的循环右移，将rm寄存器右移1位，最高位用标志位填充

rrx r1,r1

### cmp

cmp{cond} rn,operand2

rn-operand2和subs指令差不多，但是他不保存计算结果只设置标志位

cmp r0,#0 @判断r0寄存器的值是否为0

### cmn

cmn{cond} rn,operand2

rn+operand2和adds差不多，但不保存计算结果，只设置标志位

cmn r0,r1

### tst

tst{cond} rn,operand2

rn&operand2和ands差不多，但不保存结果，只设置标志位

tst r0,#1 @判断r0寄存器最低位是否为1

### teq

teq{cond} rn,operand2

rn^operand2和eors差不多，但不保存结果，只设置标志位

teq r0,r1 @判断r0和r1是否相等

## 其他指令

### swi

软中断指令，用于产生中断，可以从用户模式切换的管理模式

swi{cond},immed_24

immed_24:24位的中断号，在Android中，系统调用为0号中断，使用r7寄存器存放系统调用，使用r0-r3传递前4个参数，对应大于4个参数的调用，剩余的采用堆栈传递，如：exit(0)

```
mov r0,#0
mov r7,#1
swi #0
```

### nop

空操作，一般用于字节码对齐

### mrs

读状态寄存器

msr rd,psr

psr取值可以是cpsr,spsr

msr r0,cpsr @读取cpsr寄存器到r0寄存器中

### msr

写状态寄存器

msr rd,psr_fields,operand2

psr取值cpsr,spsr

| field | 含义         |
| ----- | ---------- |
| c     | 控制域[7:0]   |
| x     | 扩展域[15:8]  |
| s     | 状态域[23:16] |
| f     | 标志位[31:24] |

```assembly
mrs r0,cpsr @读取cpsr值到r0

bic r0,r0,#0x80 @清除r0寄存器第7位

msr cpsr_c,r0 @开启irq中断

mov pc,lr @子程序返回
```

# hello world

这里我写一个arm版的hello world

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



































