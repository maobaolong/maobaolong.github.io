---
title: elf文件格式
date: 2016-08-14 21:47:34
categories: elf
tags: 
    - elf
---

# 简介

在计算机科学中，是一种用于二进制文件、可执行文件、目标代码、共享库和核心转储的标准文件格式。
是UNIX系统实验室（USL）作为应用程序二进制接口（Application Binary Interface，ABI）而开发和发布的，也是Linux的主要可执行文件格式。在android中同样也是该格式，但是有部分不太一样可以在[官网查看ARM ELF File Format](https://developer.android.com/ndk/guides/abis.html?hl=is)他会跳到[arm官方格式定义文档](http://infocenter.arm.com/help/topic/com.arm.doc.dui0101a/DUI0101A_Elf.pdf)

# 类型

elf文件分三种类型

relocatable file：可重定位文件，一般有汇编器生成的.o文件还未进行链接，链接后生成可执行的对象文件和可共享的对象文件。也可以使用ar工具将多个.o文件归档成.a静态库文件
executable file：可执行文件
shared object file：即.so文件

我们从上面的文档中发现，可执行文件和链接文件他们的结构不太一样

Linking View

| ELF Header                      |
| ------------------------------- |
| Program Header Table (Optional) |
| Section 1                       |
| ...                             |
| Section Header Table            |

Execution View

| ELF Header                      |
| ------------------------------- |
| Program Header Table            |
| Segment 1                       |
| ...                             |
| Section Header Table (Optional) |

# 数据类型

elf格式中会有很多自定义数据类型

| 类型            | 大小   | 对齐   | 解释      |
| ------------- | ---- | ---- | ------- |
| Elf32_Addr    | 4    | 4    | 无符号程序地址 |
| Elf32_Half    | 2    | 2    | 无符号短整数  |
| Elf32_Off     | 4    | 4    | 无符号文件偏移 |
| Elf32_Sword   | 4    | 4    | 有符号大整数  |
| Elf32_Word    | 4    | 4    | 无符号大整数  |
| unsigned char | 1    | 1    | 无符号小整数  |

他的定义可以在types_elf.h中查看

```
typedef uint32 Elf32_Addr;  // Unsigned program address
typedef uint16 Elf32_Half;  // Unsigned medium integer
typedef uint32 Elf32_Off;  // Unsigned file offset
typedef int32 Elf32_Sword;  // Signed large integer
typedef uint32 Elf32_Word;  // Unsigned large integer
```

# 查看工具

## file

基本信息我们可以用file命令查看

```
file hello 
```

```
hello: ELF 32-bit LSB executable, ARM, version 1 (SYSV), dynamically linked (uses shared libs), stripped
```

## readelf

### 显示头部信息

arm-linux-androideabi-readelf -h hello

```
ELF Header:
  Magic:   7f 45 4c 46 01 01 01 00 00 00 00 00 00 00 00 00 
  Class:                             ELF32
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  ABI Version:                       0
  Type:                              EXEC (Executable file)
  Machine:                           ARM
  Version:                           0x1
  Entry point address:               0x8478
  Start of program headers:          52 (bytes into file)
  Start of section headers:          8552 (bytes into file)
  Flags:                             0x5000200, Version5 EABI, soft-float ABI
  Size of this header:               52 (bytes)
  Size of program headers:           32 (bytes)
  Number of program headers:         8
  Size of section headers:           40 (bytes)
  Number of section headers:         24
  Section header string table index: 23
```

上面看的是可执行文件，下面我们看看，共享文件

```
ELF Header:
  Magic:   7f 45 4c 46 01 01 01 00 00 00 00 00 00 00 00 00 
  Class:                             ELF32
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  ABI Version:                       0
  Type:                              DYN (Shared object file)
  Machine:                           ARM
  Version:                           0x1
  Entry point address:               0x0
  Start of program headers:          52 (bytes into file)
  Start of section headers:          12616 (bytes into file) //10进制,要转换为16进制查看所在内存地址
  Flags:                             0x5000200, Version5 EABI, soft-float ABI
  Size of this header:               52 (bytes)
  Size of program headers:           32 (bytes)
  Number of program headers:         8
  Size of section headers:           40 (bytes)
  Number of section headers:         22
  Section header string table index: 21
```

我们可以从type区分出他们的类型。

Entry point address:程序的入口地址，共享文件没有入口点

### 显示节(section)信息

arm-linux-androideabi-readelf -S hello

```
There are 24 section headers, starting at offset 0x2168:

Section Headers:
  [Nr] Name              Type            Addr     Off    Size   ES Flg Lk Inf Al
  [ 0]                   NULL            00000000 000000 000000 00      0   0  0
  [ 1] .interp           PROGBITS        00008134 000134 000013 00   A  0   0  1
  [ 2] .dynsym           DYNSYM          00008148 000148 0000e0 10   A  3   1  4
  [ 3] .dynstr           STRTAB          00008228 000228 0000c4 00   A  0   0  1
  [ 4] .hash             HASH            000082ec 0002ec 00004c 04   A  2   0  4
  [ 5] .rel.dyn          REL             00008338 000338 000010 08   A  2   0  4
  [ 6] .rel.plt          REL             00008348 000348 000048 08  AI  2   7  4
  [ 7] .plt              PROGBITS        00008390 000390 000080 00  AX  0   0  4
  [ 8] .text             PROGBITS        00008410 000410 0016d0 00  AX  0   0  4
  [ 9] .note.android.ide PROGBITS        00009ae0 001ae0 000018 00   A  0   0  4
  [10] .ARM.exidx        ARM_EXIDX       00009af8 001af8 000110 08  AL  8   0  4
  [11] .ARM.extab        PROGBITS        00009c08 001c08 00003c 00   A  0   0  4
  [12] .rodata           PROGBITS        00009c48 001c48 000028 01 AMS  0   0  8
  [13] .fini_array       FINI_ARRAY      0000ae84 001e84 000008 00  WA  0   0  4
  [14] .init_array       INIT_ARRAY      0000ae8c 001e8c 000010 00  WA  0   0  4
  [15] .preinit_array    PREINIT_ARRAY   0000ae9c 001e9c 000008 00  WA  0   0  4
  [16] .dynamic          DYNAMIC         0000aea4 001ea4 0000f8 08  WA  3   0  4
  [17] .got              PROGBITS        0000af9c 001f9c 000064 00  WA  0   0  4
  [18] .data             PROGBITS        0000b000 002000 000014 00  WA  0   0  4
  [19] .bss              NOBITS          0000b014 002014 000004 00  WA  0   0  4
  [20] .comment          PROGBITS        00000000 002014 000026 01  MS  0   0  1
  [21] .note.gnu.gold-ve NOTE            00000000 00203c 00001c 00      0   0  4
  [22] .ARM.attributes   ARM_ATTRIBUTES  00000000 002058 00002b 00      0   0  1
  [23] .shstrtab         STRTAB          00000000 002083 0000e3 00      0   0  1
Key to Flags:
  W (write), A (alloc), X (execute), M (merge), S (strings)
  I (info), L (link order), G (group), T (TLS), E (exclude), x (unknown)
  O (extra OS processing required) o (OS specific), p (processor specific)
➜  armeabi arm-linux-androideabi-readelf -S libhello.so 
```

动态文件

arm-linux-androideabi-readelf -S libhello.so

```
There are 22 section headers, starting at offset 0x3148:

Section Headers:
  [Nr] Name              Type            Addr     Off    Size   ES Flg Lk Inf Al
  [ 0]                   NULL            00000000 000000 000000 00      0   0  0
  [ 1] .interp           PROGBITS        00000134 000134 000013 00   A  0   0  1
  [ 2] .dynsym           DYNSYM          00000148 000148 0003d0 10   A  3   1  4
  [ 3] .dynstr           STRTAB          00000518 000518 0004b1 00   A  0   0  1
  [ 4] .hash             HASH            000009cc 0009cc 000190 04   A  2   0  4
  [ 5] .rel.dyn          REL             00000b5c 000b5c 000048 08   A  2   0  4
  [ 6] .rel.plt          REL             00000ba4 000ba4 000048 08  AI  2   7  4
  [ 7] .plt              PROGBITS        00000bec 000bec 000080 00  AX  0   0  4
  [ 8] .text             PROGBITS        00000c6c 000c6c 001664 00  AX  0   0  4
  [ 9] .ARM.extab        PROGBITS        000022d0 0022d0 00003c 00   A  0   0  4
  [10] .ARM.exidx        ARM_EXIDX       0000230c 00230c 000110 08  AL  8   0  4
  [11] .rodata           PROGBITS        00002420 002420 000028 01 AMS  0   0  8
  [12] .fini_array       FINI_ARRAY      00003eac 002eac 000008 00  WA  0   0  4
  [13] .init_array       INIT_ARRAY      00003eb4 002eb4 000004 00  WA  0   0  1
  [14] .dynamic          DYNAMIC         00003eb8 002eb8 0000f8 08  WA  3   0  4
  [15] .got              PROGBITS        00003fb0 002fb0 000050 00  WA  0   0  4
  [16] .data             PROGBITS        00004000 003000 000018 00  WA  0   0  4
  [17] .bss              NOBITS          00004018 003018 000000 00  WA  0   0  1
  [18] .comment          PROGBITS        00000000 003018 000026 01  MS  0   0  1
  [19] .note.gnu.gold-ve NOTE            00000000 003040 00001c 00      0   0  4
  [20] .ARM.attributes   ARM_ATTRIBUTES  00000000 00305c 00002b 00      0   0  1
  [21] .shstrtab         STRTAB          00000000 003087 0000c0 00      0   0  1
Key to Flags:
  W (write), A (alloc), X (execute), M (merge), S (strings)
  I (info), L (link order), G (group), T (TLS), E (exclude), x (unknown)
  O (extra OS processing required) o (OS specific), p (processor specific)
```

那什么是节呢，节是elf文件里用来装载内容数据的最小容器。其中每一个sections内部都装载了性质和属性差不多的内容如：

.text section：可以执行代码

.data section:初始化数据

.bss section:未初始时数据

等，一个文件到底有哪些section，是有这个elf中的section head table(sht)决定的。

# dex文件整体结构

## ELF Header

头部定义android-ndk-r11c/platforms/android-24/arch-arm/usr/include/linux/elf.h

```c++
#define EI_NIDENT 16
typedef struct elf32_hdr{
	/* WARNING: DO NOT EDIT, AUTO-GENERATED CODE - SEE TOP FOR INSTRUCTIONS */
	 unsigned char e_ident[EI_NIDENT]; //固定值7f 45 4c 46 01 01 01 00  00 00 00 00 00 00 00 00, ELF
	 Elf32_Half e_type;
	 Elf32_Half e_machine;
	 Elf32_Word e_version;
	/* WARNING: DO NOT EDIT, AUTO-GENERATED CODE - SEE TOP FOR INSTRUCTIONS */
	 Elf32_Addr e_entry;
	 Elf32_Off e_phoff; //程序头(Program Header)内容在整个文件的偏移值
	 Elf32_Off e_shoff; //段头(Section Header)内容在这个文件的偏移值
	 Elf32_Word e_flags; 
	/* WARNING: DO NOT EDIT, AUTO-GENERATED CODE - SEE TOP FOR INSTRUCTIONS */
	 Elf32_Half e_ehsize;
	 Elf32_Half e_phentsize;
	 Elf32_Half e_phnum; //程序头的个数
	 Elf32_Half e_shentsize;
	/* WARNING: DO NOT EDIT, AUTO-GENERATED CODE - SEE TOP FOR INSTRUCTIONS */
	 Elf32_Half e_shnum; //段头的个数
	 Elf32_Half e_shstrndx; //String段在整个段列表中的索引值
} Elf32_Ehdr;
```

当然定义也可以在/external/chromium_org/courgette/types_elf.h看到上面的定义

每个字段的解释如下：

| 字段名称        | 偏移值  | 长度   | 说明                                       |
| ----------- | ---- | ---- | ---------------------------------------- |
| e_ident     | 0x0  | 16   | elf文件幻数                                  |
| e_type      | 0x10 | 2    | 该文件的类型,见e_type表                          |
| e_machine   | 0x12 | 2    | 程序运行的体系结构,见e_machine表                    |
| e_version   | 0x14 | 4    | 文件版本,1表示当前版本                             |
| e_entry     | 0x18 | 4    | 程序入口点,动态链接文件没有入口，为0                      |
| e_phoff     | 0x1c | 4    | 程序头表(program header table)偏移量,如果没有为0     |
| e_shoff     | 0x20 | 4    | section头表(section header table)偏移,如果没有为0 |
| e_flags     | 0x24 | 4    | 特定处理器标志,采用EF_machine_flag格式              |
| e_ehsize    | 0x28 | 2    | elf头的大小,Size of this header就是这个字段        |
| e_phentsize | 0x2a | 2    | 程序头表(program header table)大小,Size of program headers |
| e_phnum     | 0x2c | 2    | 程序头表(program header table)个数, Number of program headers |
| e_shentsize | 0x2e | 2    | section头的大小(单个), Size of section headers |
| e_shnum     | 0x30 | 2    | section header table中的入口数目               |
| e_shstrndx  | 0x32 | 2    | 跟section名字字符表相关入口的section头表(section header table)索引,//TODO |

### e_type

| 名称        | 值      | 解释                 |
| --------- | ------ | ------------------ |
| ET_NONE   | 0      | No file type       |
| ET_REL    | 1      | Relocatable file   |
| ET_EXEC   | 2      | Executable file    |
| ET_DYN    | 3      | Shared object file |
| ET_CORE   | 4      | Core file          |
| ET_LOPROC | 0xff00 | Processor-specific |
| ET_HIPROC | 0xffff | Processor-specific |

其中CORE的文件内容未被指明，他是保留的

ET_LOPROC-ET_HIPROC是为特殊处理器保留的

### e_machine

| 名称       | 值    | 解释             |
| -------- | ---- | -------------- |
| EM_NONE  | 0    | No machine     |
| EM_M32   | 1    | AT&T WE 32100  |
| EM_SPARC | 2    | SPARC          |
| EM_386   | 3    | Intel 80386    |
| EM_68K   | 4    | Motorola 68000 |
| EM_88K   | 5    | Motorola 88000 |
| EM_860   | 7    | Intel 80860    |
| EM_MIPS  | 8    | MIPS RS3000    |
|          | 28   | ARM            |

## Section

节，它包含了目标文件中除了elf头部，程序头部表格，节区头部表格外所有内容。他们有如下特点：

1. 目标文件中每个节区都有对应的头部描述他，返回来则不成立
2. 每个节区占用文件中一个连续的位置(可能为0)
3. 节区不允许重叠
4. 目标文件可能包含分活动空间(inactive space)，这些区域不属于任何头部和节区，他们没实际作用

## Section Header

只有文件是链接格式才有效，elf头中e_shoff指出了节区的偏移，e_shnum指出了表格条目数，e_shentsize给出了每项的字节数，所以根据这些信息我们就可以定位所以节信息。Section Header是对每一个section进行了一些描述，包括名称，类型，大小，在整个文件的整体偏移位置，他的定义如下

```c++
struct Elf32_Shdr {
  Elf32_Word   sh_name;
  Elf32_Word   sh_type;
  Elf32_Word   sh_flags;
  Elf32_Addr   sh_addr;
  Elf32_Off    sh_offset;
  Elf32_Word   sh_size;
  Elf32_Word   sh_link;
  Elf32_Word   sh_info;
  Elf32_Word   sh_addralign;
  Elf32_Word   sh_entsize;
};
```

我们从上面的信息显示这个文件有22个section，他的其使用位置可以从header中查看为12616转为16进制为0x3148，所以section header的开始位置就是这里，每个字段的解释如下：

| 字段名称         | 长度   | 说明                                       |
| ------------ | ---- | ---------------------------------------- |
| sh_name      | 4    | section的名字，值是String Table中的索引            |
| sh_type      | 4    | 把sections按内容和意义分类，见sh_type表              |
| sh_flags     | 4    | sections支持位的标记，用来描述多个属性,见sh_flags表       |
| sh_addr      | 4    | 如果该section加载到内存为内存地址，否则为0                |
| sh_offset    | 4    | 该section的真实偏移位置，SHT_NOBITS类的section不暂用空间 |
| sh_size      | 4    | section的字节大小，如果类型为SHT_NOBITS为0           |
| sh_link      | 4    | section报头表的索引连接,具体的还得依据他的类型来解释这个值,见sh_link表 |
| sh_info      | 4    | 额外的信息，解释依靠该section的类型                    |
| sh_addralign | 4    | 地址对齐的约束,假如一个section保存着双字，系统就必须确定整个section是否双字对齐。所以sh_addr的值以sh_addralign的值取模结果必须为0，目前取值为0和2的幂次数。如果是值为0和1表示没有对齐约束 |
| sh_entsize   | 4    | 保存着一张固定大小入口的表，就象符号表。对于这类节区，这个值为表每项的长度(字节)，如果不包含值为0 |

根据上面的信息我们总结出21个section

| sh_name | sh_type  | sh_flags | sh_addr | sh_offset | sh_size | sh_link | sh_info | sh_addralign | sh_entsize |
| ------- | -------- | -------- | ------- | --------- | ------- | ------- | ------- | ------------ | ---------- |
| 0       | 0        | 0        | 0       | 0         | 0       | 0       | 0       | 0            | 0          |
| 0xb     | 0x1      | 0x2      | 0x134   | 0x134     | 0x13    | 0x0     | 0x0     | 0x1          | 0x0        |
| 0x13    | 0xb      | 0x2      | 148     | 148       | 3d0     | 3       | 1       | 4            | 10         |
| 1b      | 3        | 2        | 518     | 518       | 4b1     | 0       | 0       | 1            | 0          |
| 23      | 5        | 2        | 9cc     | 9cc       | 190     | 2       | 0       | 4            | 4          |
| 29      | 9        | 2        | b5c     | b5c       | 48      | 2       | 0       | 4            | 8          |
| 32      | 9        | 42       | ba4     | ba4       | 48      | 2       | 7       | 4            | 8          |
| 36      | 1        | 6        | bec     | bec       | 80      | 0       | 0       | 4            | 0          |
| 3b      | 1        | 6        | c6c     | c6c       | 1664    | 0       | 0       | 4            | 0          |
| 41      | 1        | 2        | 22d0    | 22d0      | 3c      | 0       | 0       | 4            | 0          |
| 4c      | 70000001 | 82       | 23c0    | 23c0      | 110     | 8       | 0       | 4            | 8          |
| 57      | 1        | 32       | 2420    | 2420      | 28      | 0       | 0       | 8            | 1          |
| 5f      | f        | 3        | 3eac    | 2eac      | 8       | 0       | 0       | 4            | 0          |
| 6b      | e        | e        | 3eb4    | 2eb4      | 4       | 0       | 0       | 1            | 0          |
| 77      | 6        | 3        | 3eb8    | 2eb8      | f8      | 3       | 0       | 4            | 8          |
| 80      | 1        | 3        | 3fb0    | 2fb0      | 50      | 0       | 0       | 4            | 0          |
| 85      | 1        | 3        | 4000    | 3000      | 18      | 0       | 0       | 4            | 0          |
| 8b      | 8        | 3        | 4018    | 3018      | 0       | 0       | 0       | 1            | 0          |
| 90      | 1        | 30       | 0       | 3018      | 26      | 0       | 0       | 1            | 1          |
| 99      | 7        | 0        | 0       | 3040      | 1c      | 0       | 0       | 4            | 0          |
| b0      | 70000003 | 0        | 0       | 305c      | 2b      | 0       | 0       | 1            | 0          |
| 1       | 3        | 0        | 0       | 3087      | c0      | 0       | 0       | 1            | 0          |

### sh_type

指示改section的意义

| 值            | 名称         | 解释                                       |
| ------------ | ---------- | ---------------------------------------- |
| SHT_NULL     | 0          | section无效,其他成员的值也是未定义的                   |
| SHT_PROGBITS | 1          | 程序定义了一些信息,格式和意义取决于程序本身                   |
| SHT_SYMTAB   | 2          | 他和SHT_DYNSYM(保存动态链接时所需最小标号集合),为连接器提供标号,也可以被动态链接器使用。SHT_SYMTAB他可能包含动态链接不需要的标号，见Symbol Table表 |
| SHT_STRTAB   | 3          | 保存字符串列表，一个文件可能包含多个，见String Table         |
| SHT_RELA     | 4          | 保存具有明确加数的重定位入口,一个object文件可能有多个重定位的sections,见Relocation |
| SHT_HASH     | 5          | 保存一个hash表,所有参与动态链接的object一定包含一个标记哈希表,见Hash Table |
| SHT_DYNAMIC  | 6          | 保存动态链接信息,当前(后面可能取消)一个文件只有一个,见Dynamic Section |
| SHT_NOTE     | 7          | 保存其他的一些标志文件信息，见Note Section              |
| SHT_NOBITS   | 8          | 在文件不暂用空间，类似SHT_PROGBITS,虽然不包含字节,但包含了概念的上文件偏移量 |
| SHT_REL      | 9          | 保存着具有明确加数的重定位的入口,见Relocation             |
| SHT_SHLIB    | 10         | 保留类型                                     |
| SHT_DYNSYM   | 11         |                                          |
| SHT_LOPROC   | 0x70000000 | 在这范围之间的值为特定处理器语意保留的                      |
| SHT_HIPROC   | 0x7fffffff | 在这范围之间的值为特定处理器语意保留的                      |
| SHT_LOUSER   | 0x80000000 | 应用程序保留的索引范围的最小边界,可能被应用程序使用               |
| SHT_HIUSER   | 0xffffffff | 应用程序保留的索引范围的最大边界,可能被应用程序使用               |

### Symbol Table

### String Table

### Relocation

### Hash Table

### sh_flags

用来描述section的属性，下面是定义的值，其他的保留

| 值          | 名称            | 解释                     |
| ---------- | ------------- | ---------------------- |
| 0x1        | ￼￼￼SHF_WRITE  | 可被写的数据                 |
| 0x2        | SHF_ALLOC     | 在进程执行过程中占据着内存          |
| 0x4        | SHF_EXECINSTR | 包含了可执行的机器指令            |
| 0xf0000000 | SHF_MASKPROC  | 所有的包括在这掩码中的位为特定处理语意保留的 |

### sh_link & sh_info

根据节的类型不同，这两个字段的含义也不尽相同

| sh_type               | sh_link              | sh_info                           |
| --------------------- | -------------------- | --------------------------------- |
| SHT_DYNAMIC           | 该节中条目所用到的字符串表格节区头部索引 | 0                                 |
| SHT_HASH              | 此哈希表所适用的符号表的节区头部索引   | 0                                 |
| SHT_REL,SHT_RELA      | 相关符号表的节区头部索引         | 重定位所适用的节区的                        |
| SHT_SYMTAB,SHT_DYNSYM | 相关联的字符串表的节区头部索引      | 最后一个局部符号(绑 定 STB_LOCAL)的符 号表索引值加一 |
| 其它                    | SHN_UNDEF            | 0                                 |

### 特殊节区(special sections)

就是包含了程序和控制信息，由系统定义的，在运行程序时需要使用的节区

| 节名称                       | 节类型          | 节属性                     | 意思                                       |
| ------------------------- | ------------ | ----------------------- | ---------------------------------------- |
| .bss                      | SHT_NOBITS   | SHF_ALLOC,SHF_WRITE     | 该sectiopn保存着未初始化的数据，这些数据存在于程序内存映象中。      |
| .comment                  | SHT_PROGBITS | 无属性                     | 包含版本控制信息                                 |
| .data                     | 同上           | SHF_ALLOC,SHF_WRITE     | 初始化了数据，将出现在程序内存映像中                       |
| .data1                    | 同上           | 同上                      | 同上                                       |
| .debug                    | 同上           | 无                       | 包含用于符号调试的信息                              |
| .dynamic                  | SHT_DYNAMIC  |                         | 动态链接信息，节区属性包含SHF_ALLOC,是否设置SHF_WRITE位取决于处理器 |
| .dynstr                   | SHT_STRTAB   | SHF_ALLOC               | 用于动态链接的字符串，大多数情况下这些字符串代表了与符号表现相关的名称      |
| .dynsym                   | SHT_DYNSYM   | SHF_ALLOC               | 动态链接符号表                                  |
| .fini                     | SHT_PROGBITS | SHF_ALLOC,SHF_EXECINSTR | 可执行指令,是进程终止代码的一部分,程序正常退出时，系统将执行这里的代码     |
| .got                      | SHT_PROGBITS |                         | 全局偏移表                                    |
| .hash                     | SHT_HASH     | SHF_ALLOC               | 包含一个符号hash表                              |
| .init                     | SHT_PROGBITS | SHF_ALLOC,SHF_EXECINSTR | 可执行指令,是进程初始化代码的一部分,系统在调用入口之前执行这些代码       |
| .interp                   | SHT_PROGBITS |                         | 该section保存了程序的解释程序(interpreter)的路径。假如在这个section中有一个可装载的段，那么该section的属性的SHF_ALLOC位将被设置；否则，该位不会被设置。看第二部分获得更多的信息 |
| .line                     | SHT_PROGBITS | 无                       | 符号调试行号信息，描述源程序与机器指令之间的对应关系，其中内容是未定义的     |
| .note                     | SHT_NOTE     | 无                       | 包含注释信息,有特定的格式,见Note Section              |
| .plt                      | SHT_PROGBITS |                         | 该section保存着过程连接表(Procedure Linkage Table)看第一部分的Special Sections''和第二部分的“Procedure Linkage Table” |
| `.rel<name> ,.rela<name>` | SHT_REL      |                         | 这些section保存着重定位的信息，看下面的``Relocation''描述。假如文件包含了一个可装载的段，并且这个段是重定位的，那么该section的属性将设置SHF_ALLOC位；否则该位被关闭。按照惯例，<name>由重定位适用的section来提供。因此，一个重定位的section适用的是.text，那么该名字就为.rel.text或者是.rela.text。 |
| .rodata,.rodata11         | SHT_PROGBITS | SHF_ALLOC               | 保存着只读数据，在进程映象中构造不可写的段                    |
| .shstrtab                 | SHT_STRTAB   |                         | 保存着section名称                             |
| .strtab                   | SHT_STRTAB   |                         | 保存着字符串，一般地，描述名字的字符串和一个标号的入口相关联。假如文件有一个可装载的段，并且该段包括了符号字符串表，那么section的SHF_ALLOC属性将被设置为1 |
| .symtab                   | SHT_SYMTAB   |                         | 包含一个符号表,假如文件有一个可装载的段，并且该段包含了符号表，那么section的SHF_ALLOC属性将被设置为1 |
| .text                     | SHT_PROGBITS | SHF_ALLOC,SHF_EXECINSTR | 可执行指令                                    |

> 注意：
>
> 1. 以.开头的节区名称是系统保留的，应用程序可以定义没有.前缀的节区名称，避免与系统节区冲突
> 2. 目标文件格式允许我们定义自己的节区
> 3. 可以包含多个名称相同的节区
> 4. 保留给处理器体系结构的节区名称一般为:处理器体系结构简写(与e_machine相同)+节区名称,如:.arm.other,意思是arm处理器的other区

有些编译器扩展了节区,如下：

.sdata

.tdesc

.sbss

.lit4

.lit8

.reginfo

.gptab

.liblist

.conflict

#### Hash Table

### 字符串表(String Table)































