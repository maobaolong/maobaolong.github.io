---
title: Dex文件格式
date: 2016-07-23 09:21:53
categories: Dalvik
tags: 
    - Dex
---

# 什么是dex文件

他是Android系统的可执行文件，包含应用程序的全部操作指令以及运行时数据。

由于dalvik是一种针对嵌入式设备而特殊设计的java虚拟机，所以dex文件与标准的class文件在结构设计上有着本质的区别

当java程序编译成class后，还需要使用dx工具将所有的class文件整合到一个dex文件，目的是其中各个类能够共享数据，在一定程度上降低了冗余，同时也是文件结构更加经凑，实验表明，dex文件是传统jar文件大小的50%左右

![](http://i.stack.imgur.com/1kLrB.png)

可以看见：
dex将原来class每个文件都有的共有信息合成一体，这样减少了class的冗余

# 数据结构

|    类型     |        含义         |
| :-------: | :---------------: |
|    u1     |  unit8_t,1字节无符号数  |
|    u2     | unit16_t,2字节无符号数  |
|    u4     | unit32_t,4字节无符号数  |
|    u8     | unit64_t,8字节无符号数  |
|  sleb128  | 有符号LEB128,可变长度1~5 |
|  uleb128  |    无符号LEB128,     |
| uleb128p1 |   无符号LEB128值加1，   |

其中u1~u8很好理解,[不理解的可以参考这里](http://blog.csdn.net/zklth/article/details/7978362)，表示1到8个字节的无符号数，后面三个是dex特有的数据类型，更详细的参考：(深入到源码解析leb128数据类型)[http://i.woblog.cn/2016/07/23/leb128-format/]

# dex文件结构

首先从宏观上来说dex的文件结果很简单，实际上是由多个不同结构的数据体以首尾相接的方式拼接而成。如下图：

|    数据名称    |                解释                |
| :--------: | :------------------------------: |
|   header   |      dex文件头部，记录整个dex文件的相关属性      |
| string_ids |     字符串数据索引，记录了每个字符串在数据区的偏移量     |
|  type_ids  |       类似数据索引，记录了每个类型的字符串索引       |
| proto_ids  | 原型数据索引，记录了方法声明的字符串，返回类型字符串，参数列表  |
| field_ids  |      字段数据索引，记录了所属类，类型以及方法名       |
| method_ids |   类方法索引，记录方法所属类名，方法声明以及方法名等信息    |
| class_defs | 类定义数据索引，记录指定类各类信息，包括接口，超类，类数据偏移量 |
|    data    |         数据区，保存了各个类的真是数据          |
| link_data  |              连接数据区               |


/dalvik/libdex/DexFile.h

定义如下：

```c++
struct DexFile {
    const DexHeader*    pHeader;
    const DexStringId*  pStringIds;
    const DexTypeId*    pTypeIds;
    const DexFieldId*   pFieldIds;
    const DexMethodId*  pMethodIds;
    const DexProtoId*   pProtoIds;
    const DexClassDef*  pClassDefs;
    const DexLink*      pLinkData;
}
```

>注意：其中一些定义的字段是在内存中并没有存到真是的dex文件中


# header

简单记录了dex文件的一些基本信息，以及大致的数据分布。长度固定为0x70,其中每一项信息所占用的内存空间也是固定的，好处是虚拟机在处理dex时不用考虑dex文件的多样性

|      字段名称       | 偏移值  |  长度  |             说明              |
| :-------------: | :--: | :--: | :-------------------------: |
|      magic      | 0x0  |  8   |     魔数字段，值为"dex\n035\0"     |
|    checksum     | 0x8  |  4   |             校验码             |
|    signature    | 0xc  |  20  |           sha-1签名           |
|    file_size    | 0x20 |  4   |          dex文件总长度           |
|   header_size   | 0x24 |  4   | 文件头长度，009版本=0x5c,035版本=0x70 |
|   endian_tag    | 0x28 |  4   |          标示字节顺序的常量          |
|    link_size    | 0x2c |  4   |      链接段的大小，如果为0就是静态链接      |
|    link_off     | 0x30 |  4   |          链接段的开始位置           |
|     map_off     | 0x34 |  4   |           map数据基址           |
| string_ids_size | 0x38 |  4   |         字符串列表中字符串个数         |
| string_ids_off  | 0x3c |  4   |           字符串列表基址           |
|  type_ids_size  | 0x40 |  4   |          类列表里的类型个数          |
|  type_ids_off   | 0x44 |  4   |            类列表基址            |
| proto_ids_size  | 0x48 |  4   |         原型列表里面的原型个数         |
|  proto_ids_off  | 0x4c |  4   |           原型列表基址            |
| field_ids_size  | 0x50 |  4   |            字段个数             |
|  field_ids_off  | 0x54 |  4   |           字段列表基址            |
| method_ids_size | 0x58 |  4   |            方法个数             |
| method_ids_off  | 0x5c |  4   |           方法列表基址            |
| class_defs_size | 0x60 |  4   |          类定义标中类的个数          |
| class_defs_off  | 0x64 |  4   |           类定义列表基址           |
|    data_size    | 0x68 |  4   |        数据段的大小，必须4k对齐        |
|    data_off     | 0x6c |  4   |            数据段基址            |


/dalvik/libdex/DexFile.h

定义如下：

```c++
struct DexHeader {
    u1  magic[8];           /* includes version number */
    u4  checksum;           /* adler32 checksum */
    u1  signature[kSHA1DigestLen]; /* SHA-1 hash */
    u4  fileSize;           /* length of entire file */
    u4  headerSize;         /* offset to start of next section */
    u4  endianTag;
    u4  linkSize;
    u4  linkOff;
    u4  mapOff;
    u4  stringIdsSize;
    u4  stringIdsOff;
    u4  typeIdsSize;
    u4  typeIdsOff;
    u4  protoIdsSize;
    u4  protoIdsOff;
    u4  fieldIdsSize;
    u4  fieldIdsOff;
    u4  methodIdsSize;
    u4  methodIdsOff;
    u4  classDefsSize;
    u4  classDefsOff;
    u4  dataSize;
    u4  dataOff;
};
```

我们可以用：hexdump -c classes.dex查看dex单字节显示的结果，如下：

```shell
0000000   d   e   x  \n   0   3   5  \0 022 217   ?   w   z   ? 031 221
0000010   ?  \f   ?   ?   ?   ?   ?   ? 217 235 200   z   ? 030   I   ?
0000020   ? 003  \0  \0   p  \0  \0  \0   x   V   4 022  \0  \0  \0  \0
0000030  \0  \0  \0  \0   ? 002  \0  \0 024  \0  \0  \0   p  \0  \0  \0
0000040  \b  \0  \0  \0   ?  \0  \0  \0 005  \0  \0  \0   ?  \0  \0  \0
0000050 001  \0  \0  \0 034 001  \0  \0 005  \0  \0  \0   $ 001  \0  \0
0000060 001  \0  \0  \0   L 001  \0  \0   8 002  \0  \0   l 001  \0  \0
0000070   l 001  \0  \0   t 001  \0  \0 201 001  \0  \0 204 001  \0  \0
0000080 222 001  \0  \0 226 001  \0  \0   ? 001  \0  \0   ? 001  \0  \0
0000090   ? 001  \0  \0   ? 001  \0  \0 004 002  \0  \0  \a 002  \0  \0
00000a0  \v 002  \0  \0     002  \0  \0   ( 002  \0  \0   . 002  \0  \0
00000b0   4 002  \0  \0   9 002  \0  \0   B 002  \0  \0   L 002  \0  \0
00000c0 003  \0  \0  \0 005  \0  \0  \0 006  \0  \0  \0  \a  \0  \0  \0
00000d0  \b  \0  \0  \0  \t  \0  \0  \0  \n  \0  \0  \0  \f  \0  \0  \0
00000e0 002  \0  \0  \0 003  \0  \0  \0  \0  \0  \0  \0 004  \0  \0  \0
00000f0 004  \0  \0  \0   x 002  \0  \0  \n  \0  \0  \0 006  \0  \0  \0
0000100  \0  \0  \0  \0  \v  \0  \0  \0 006  \0  \0  \0   x 002  \0  \0
0000110  \v  \0  \0  \0 006  \0  \0  \0   p 002  \0  \0 005  \0 001  \0
0000120 020  \0  \0  \0  \0  \0 004  \0 017  \0  \0  \0 001  \0 003  \0
0000130 021  \0  \0  \0 004  \0 002  \0  \0  \0  \0  \0 004  \0 001  \0
0000140  \r  \0  \0  \0 004  \0  \0  \0 022  \0  \0  \0  \0  \0  \0  \0
0000150 001  \0  \0  \0 002  \0  \0  \0  \0  \0  \0  \0   ?   ?   ?   ?
0000160  \0  \0  \0  \0   ? 002  \0  \0  \0  \0  \0  \0 006   <   i   n
0000170   i   t   >  \0  \v   H   e   l   l   o       W   o   r   l   d
0000180  \0 001   L  \0  \f   L   H   e   l   l   o   W   o   r   l   d
0000190   ;  \0 002   L   L  \0 025   L   j   a   v   a   /   i   o   /
00001a0   P   r   i   n   t   S   t   r   e   a   m   ;  \0 022   L   j
00001b0   a   v   a   /   l   a   n   g   /   O   b   j   e   c   t   ;
00001c0  \0 022   L   j   a   v   a   /   l   a   n   g   /   S   t   r
00001d0   i   n   g   ;  \0 031   L   j   a   v   a   /   l   a   n   g
00001e0   /   S   t   r   i   n   g   B   u   i   l   d   e   r   ;  \0
00001f0 022   L   j   a   v   a   /   l   a   n   g   /   S   y   s   t
0000200   e   m   ;  \0 001   V  \0 002   V   L  \0 023   [   L   j   a
0000210   v   a   /   l   a   n   g   /   S   t   r   i   n   g   ;  \0
0000220 006   a   p   p   e   n   d  \0 004   a   r   g   s  \0 004   m
0000230   a   i   n  \0 003   o   u   t  \0  \a   p   r   i   n   t   l
0000240   n  \0  \b   t   o   S   t   r   i   n   g  \0 016   ?   ? 231
0000250   ? 230   ?   ?   ? 200   ?   ?   ?   ? 211 213   ? 206 231   ?
0000260 232 204   s   m   a   l   i   ?   ? 236   ?   ? 213  \0  \0  \0
0000270 001  \0  \0  \0  \a  \0  \0  \0 001  \0  \0  \0 003  \0  \0  \0
0000280  \0  \0  \0  \0  \0  \0  \0  \0  \0 001 017  \a  \0  \0  \0  \0
0000290  \v  \0 001  \0 002  \0  \0  \0 210 002  \0  \0   (  \0  \0  \0
00002a0   b  \0  \0  \0  \0  \0  \0  \0  \0  \0 022   2 023 003   ?   ?
00002b0 030 004  \0  \0 001  \0  \0  \0  \0  \0 034 005 003  \0 001   &
00002c0   "  \a 004  \0   p 020 002  \0  \a  \0 032  \b 023  \0   n    
00002d0 003  \0 207  \0  \f  \a   n 020 004  \0  \a  \0  \f  \t   n    
00002e0 001  \0 220  \0 032 001 001  \0   n     001  \0 020  \0 016  \0
00002f0  \0  \0 001  \0  \0  \t 220 005 016  \0  \0  \0  \0  \0  \0  \0
0000300 001  \0  \0  \0  \0  \0  \0  \0 001  \0  \0  \0 024  \0  \0  \0
0000310   p  \0  \0  \0 002  \0  \0  \0  \b  \0  \0  \0   ?  \0  \0  \0
0000320 003  \0  \0  \0 005  \0  \0  \0   ?  \0  \0  \0 004  \0  \0  \0
0000330 001  \0  \0  \0 034 001  \0  \0 005  \0  \0  \0 005  \0  \0  \0
0000340   $ 001  \0  \0 006  \0  \0  \0 001  \0  \0  \0   L 001  \0  \0
0000350 002      \0  \0 024  \0  \0  \0   l 001  \0  \0 001 020  \0  \0
0000360 002  \0  \0  \0   p 002  \0  \0 003 020  \0  \0 002  \0  \0  \0
0000370 200 002  \0  \0 003      \0  \0 001  \0  \0  \0 210 002  \0  \0
0000380 001      \0  \0 001  \0  \0  \0 220 002  \0  \0  \0      \0  \0
0000390 001  \0  \0  \0   ? 002  \0  \0  \0 020  \0  \0 001  \0  \0  \0
00003a0   ? 002  \0  \0                                                
00003a4
```

我们还可以用-C显示16进制和ASCII码

hexdump -C classes.dex

```shell
00000000  64 65 78 0a 30 33 35 00  12 8f b1 77 7a e9 19 91  |dex.035....wz...|
00000010  f2 0c ff ce a0 ce aa cd  8f 9d 80 7a ac 18 49 bf  |...........z..I.|
00000020  a4 03 00 00 70 00 00 00  78 56 34 12 00 00 00 00  |....p...xV4.....|
00000030  00 00 00 00 f8 02 00 00  14 00 00 00 70 00 00 00  |............p...|
00000040  08 00 00 00 c0 00 00 00  05 00 00 00 e0 00 00 00  |................|
00000050  01 00 00 00 1c 01 00 00  05 00 00 00 24 01 00 00  |............$...|
00000060  01 00 00 00 4c 01 00 00  38 02 00 00 6c 01 00 00  |....L...8...l...|
00000070  6c 01 00 00 74 01 00 00  81 01 00 00 84 01 00 00  |l...t...........|
00000080  92 01 00 00 96 01 00 00  ad 01 00 00 c1 01 00 00  |................|
00000090  d5 01 00 00 f0 01 00 00  04 02 00 00 07 02 00 00  |................|
000000a0  0b 02 00 00 20 02 00 00  28 02 00 00 2e 02 00 00  |.... ...(.......|
000000b0  34 02 00 00 39 02 00 00  42 02 00 00 4c 02 00 00  |4...9...B...L...|
000000c0  03 00 00 00 05 00 00 00  06 00 00 00 07 00 00 00  |................|
000000d0  08 00 00 00 09 00 00 00  0a 00 00 00 0c 00 00 00  |................|
000000e0  02 00 00 00 03 00 00 00  00 00 00 00 04 00 00 00  |................|
000000f0  04 00 00 00 78 02 00 00  0a 00 00 00 06 00 00 00  |....x...........|
00000100  00 00 00 00 0b 00 00 00  06 00 00 00 78 02 00 00  |............x...|
00000110  0b 00 00 00 06 00 00 00  70 02 00 00 05 00 01 00  |........p.......|
00000120  10 00 00 00 00 00 04 00  0f 00 00 00 01 00 03 00  |................|
00000130  11 00 00 00 04 00 02 00  00 00 00 00 04 00 01 00  |................|
00000140  0d 00 00 00 04 00 00 00  12 00 00 00 00 00 00 00  |................|
00000150  01 00 00 00 02 00 00 00  00 00 00 00 ff ff ff ff  |................|
00000160  00 00 00 00 f0 02 00 00  00 00 00 00 06 3c 69 6e  |.............<in|
00000170  69 74 3e 00 0b 48 65 6c  6c 6f 20 57 6f 72 6c 64  |it>..Hello World|
00000180  00 01 4c 00 0c 4c 48 65  6c 6c 6f 57 6f 72 6c 64  |..L..LHelloWorld|
00000190  3b 00 02 4c 4c 00 15 4c  6a 61 76 61 2f 69 6f 2f  |;..LL..Ljava/io/|
000001a0  50 72 69 6e 74 53 74 72  65 61 6d 3b 00 12 4c 6a  |PrintStream;..Lj|
000001b0  61 76 61 2f 6c 61 6e 67  2f 4f 62 6a 65 63 74 3b  |ava/lang/Object;|
000001c0  00 12 4c 6a 61 76 61 2f  6c 61 6e 67 2f 53 74 72  |..Ljava/lang/Str|
000001d0  69 6e 67 3b 00 19 4c 6a  61 76 61 2f 6c 61 6e 67  |ing;..Ljava/lang|
000001e0  2f 53 74 72 69 6e 67 42  75 69 6c 64 65 72 3b 00  |/StringBuilder;.|
000001f0  12 4c 6a 61 76 61 2f 6c  61 6e 67 2f 53 79 73 74  |.Ljava/lang/Syst|
00000200  65 6d 3b 00 01 56 00 02  56 4c 00 13 5b 4c 6a 61  |em;..V..VL..[Lja|
00000210  76 61 2f 6c 61 6e 67 2f  53 74 72 69 6e 67 3b 00  |va/lang/String;.|
00000220  06 61 70 70 65 6e 64 00  04 61 72 67 73 00 04 6d  |.append..args..m|
00000230  61 69 6e 00 03 6f 75 74  00 07 70 72 69 6e 74 6c  |ain..out..printl|
00000240  6e 00 08 74 6f 53 74 72  69 6e 67 00 0e e8 bf 99  |n..toString.....|
00000250  e6 98 af e4 b8 80 e4 b8  aa e6 89 8b e5 86 99 e7  |................|
00000260  9a 84 73 6d 61 6c 69 e5  ae 9e e4 be 8b 00 00 00  |..smali.........|
00000270  01 00 00 00 07 00 00 00  01 00 00 00 03 00 00 00  |................|
00000280  00 00 00 00 00 00 00 00  00 01 0f 07 00 00 00 00  |................|
00000290  0b 00 01 00 02 00 00 00  88 02 00 00 28 00 00 00  |............(...|
000002a0  62 00 00 00 00 00 00 00  00 00 12 32 13 03 ff ff  |b..........2....|
000002b0  18 04 00 00 01 00 00 00  00 00 1c 05 03 00 01 26  |...............&|
000002c0  22 07 04 00 70 10 02 00  07 00 1a 08 13 00 6e 20  |"...p.........n |
000002d0  03 00 87 00 0c 07 6e 10  04 00 07 00 0c 09 6e 20  |......n.......n |
000002e0  01 00 90 00 1a 01 01 00  6e 20 01 00 10 00 0e 00  |........n ......|
000002f0  00 00 01 00 00 09 90 05  0e 00 00 00 00 00 00 00  |................|
00000300  01 00 00 00 00 00 00 00  01 00 00 00 14 00 00 00  |................|
00000310  70 00 00 00 02 00 00 00  08 00 00 00 c0 00 00 00  |p...............|
00000320  03 00 00 00 05 00 00 00  e0 00 00 00 04 00 00 00  |................|
00000330  01 00 00 00 1c 01 00 00  05 00 00 00 05 00 00 00  |................|
00000340  24 01 00 00 06 00 00 00  01 00 00 00 4c 01 00 00  |$...........L...|
00000350  02 20 00 00 14 00 00 00  6c 01 00 00 01 10 00 00  |. ......l.......|
00000360  02 00 00 00 70 02 00 00  03 10 00 00 02 00 00 00  |....p...........|
00000370  80 02 00 00 03 20 00 00  01 00 00 00 88 02 00 00  |..... ..........|
00000380  01 20 00 00 01 00 00 00  90 02 00 00 00 20 00 00  |. ........... ..|
00000390  01 00 00 00 f0 02 00 00  00 10 00 00 01 00 00 00  |................|
000003a0  f8 02 00 00                                       |....|
000003a4
```

## magic

标识一个有效的dex文件，他的固定值为：64 65 78 0a 30 33 35 00，转换为字符串为dex.035.
在电子取证中也称“文件签名”

## checksum

他是整个头部的校验和。它被用来校验头部是否损坏

## signature

## file_size

记录包括dexHeader在内的整个dex文件大小，用来计算偏移和方便定位某区段(section),他也有诸如唯一的标识dex,因为他是dex文件中计算sha-1区段的一个组成部分

## header_size

存放整个DexHeadeer结构体的长度，它也可用来计算下一个区段在文件中的起始位置，目前值为0x70

## endian_tag

指定dex运行环境的CPU字节序，存放的是一个固定值，所有dex文件都一样的，值为：78 56 34 12,0x12345678,表示默认采用little-endian字节序

## link_size 

## link_off

当多个class文件被编译到一个dex文件是，他们会用到link_size和link_off，通常为0

可以看到上面的，link_off：为00 00 00 00

## map_off

他指定了dexMapList结构的文件偏移量

## string_ids_size

是指string存放区段的大小，用来计算string区段起始位置-相对于dex文件加载基地址的偏移量

string_ids_off存放string区段的实际偏移量，单位字节。他可以帮助编译器和虚拟机直接跳到这个区段，而不必从前读到后，一直读取到该位置。
type,prototype,method,class,data id的大小(size)和偏移量(offset)和string的作用一样

每个字符串都对应一个DexStringId数据结构，大小为4B,同时虚拟机可以通过头文件中的string_ids_size知道当前dex文件中字符串的总数，也就是string_ids区域中DexStringId数据结构的总数，所以虚拟机可以通过简单的乘法运算即可实现对字符串资源的索引，也可以根据kDexTypeStringIdItem获取字符串



我们举个例子来根据header里面的字符串信息索引字符串，还是以上面的classes.dex文件来分析：

根据stringIdsSize找到有多少个DexStringId（也就是有多少个字符串）:

0x38：0x14,说明有20个字符串

根据stringIdsOff查看DexStringId的偏移量:

0x3c：0x70,说明DexStringId的开始位置在0x70

读取4个字节：6c 01 00 00，转为地址为0x16c，这就是第一个字符串的位置
在读取4个字节：74 01 00 00，0x174

分别获取这个两个位置的字符串：

06 3c 69 6e 69 74 3e 00:值为`<init>\0`,其中06表示后面有6个字符(不包括\0)
0b 48 65 6c 6c 6f 20 57 6f 72 6c 64:值为Hello World\0,0b表示有11个字符


我们发现每个字符串是使用“\0”分割的

首先他的开始位置0x70,我们根据stringIdsSize的值得知接下来有20个字符，首先我们计算DexStringId的地址截止到:0x70+0x14(20)*4=0xc0(不包括0xc0)

先获取DexStringId，然后在获取地址位置的值

| DexStringId偏移 | String偏移 | 值                         |
| ------------- | -------- | ------------------------- |
| 0x70          | 0x16c    | `<init>`                  |
| 74            | 174      | Hello World               |
| 78            | 181      | L                         |
| 7c            | 184      | LHelloWorld;              |
| 80            | 192      | LL                        |
| 84            | 196      | Ljava/io/PrintStream;     |
| 88            | 1ad      | Ljava/lang/Object;        |
| 8c            | 1c1      | Ljava/lang/String;        |
| 90            | 1d5      | Ljava/lang/StringBuilder; |
| 94            | 1f0      | Ljava/lang/System;        |
| 98            | 204      | V                         |
| 9c            | 207      | VL                        |
| a0            | 20b      | [Ljava/lang/String;       |
| a4            | 220      | append                    |
| a8            | 228      | args                      |
| ac            | 22e      | main                      |
| b0            | 234      | out                       |
| b4            | 239      | println                   |
| b8            | 242      | toString                  |
| bc            | 24c      |                           |

上面的字符串并非普通的ASCII字符串，他们是由MUTF-8编码来表示的，[更详细的介绍参考这篇文章](http://i.woblog.cn/2016/07/25/mutf-8/)

# dex文件结构分析

我们采用前面的classes.dex文件作为演示对象

dalvik虚拟机解析dex文件的内容，最终将其映射成DexMapList数据结构，DexHeader中的mapOff字段指定了DexMapList结构在dex在文件中的偏移，他的申明如下：


/dalvik/libdex/DexFile.h

```c++
struct DexMapList {
    u4  size;               /* 个数 */
    DexMapItem list[1];     /* DexMapItem的结构 */
};
```

其中size字段表示dex接来下有多少个DexMapItem结构

```c++
struct DexMapItem {
    u2 type;              /* kDexType开头的类型 */
    u2 unused;            /*未使用，用于字节对齐 */
    u4 size;              /* 类型的个数 */
    u4 offset;            /* 类型的文件偏移 */
};
```

type字段为一个枚举常量，可以通过类型名称很容易判断他的具体类型：

DexFile.h(6.0.1)

```c++
enum {
    kDexTypeHeaderItem               = 0x0000,
    kDexTypeStringIdItem             = 0x0001,
    kDexTypeTypeIdItem               = 0x0002,
    kDexTypeProtoIdItem              = 0x0003,
    kDexTypeFieldIdItem              = 0x0004,
    kDexTypeMethodIdItem             = 0x0005,
    kDexTypeClassDefItem             = 0x0006,
    kDexTypeMapList                  = 0x1000,
    kDexTypeTypeList                 = 0x1001,
    kDexTypeAnnotationSetRefList     = 0x1002,
    kDexTypeAnnotationSetItem        = 0x1003,
    kDexTypeClassDataItem            = 0x2000,
    kDexTypeCodeItem                 = 0x2001,
    kDexTypeStringDataItem           = 0x2002,
    kDexTypeDebugInfoItem            = 0x2003,
    kDexTypeAnnotationItem           = 0x2004,
    kDexTypeEncodedArrayItem         = 0x2005,
    kDexTypeAnnotationsDirectoryItem = 0x2006,
};
```

这里我们以上面的clsses.dex来分析，DexHeader结构的mapOff字段为f8 02 00 00，根据小端序，他的值为0x2f8,读取出的双字值为0e 00 00 00（0x0e）,表示接下来有14个DexMapItem结构,接着在读取0x2fc值为：0x00表示这个DexMapItem类型是kDexTypeHeaderItem，在读取0x2fe值为：0x00这个字段没有使用。在读取0x300值为：01 00 00 00表示有一个，在0x304读取:00 00 00 00表示偏移为0x0

根据上面的规则我们整理除了14个Item

| 类型                        | 个数   | 偏移    |
| ------------------------- | ---- | ----- |
| kDexTypeHeaderItem        | 0x1  | 0x0   |
| kDexTypeStringIdItem      | 0x14 | 0x70  |
| kDexTypeTypeIdItem        | 0x8  | 0xc0  |
| kDexTypeProtoIdItem       | 0x5  | 0xe0  |
| kDexTypeFieldIdItem       | 0x1  | 0x11c |
| kDexTypeMethodIdItem      | 0x5  | 0x124 |
| kDexTypeClassDefItem      | 0x1  | 0x14c |
| kDexTypeStringDataItem    | 0x14 | 0x16c |
| kDexTypeTypeList          | 0x2  | 0x270 |
| kDexTypeAnnotationSetItem | 0x2  | 0x280 |
| kDexTypeDebugsssInfoItem  | 0x1  | 0x288 |
| kDexTypeCodeItem          | 0x1  | 0x290 |
| kDexTypeClassDataItem     | 0x1  | 0x2f0 |
| kDexTypeMapList           | 0x1  | 0x2f8 |

对比文件我们发下DexHeader就是kDexTypeHeaderItem描述的结构，他占用了文件前0x70个字节空间，接下来的kDexTypeStringIdItem~kDexTypeClassDefItem与DexHeader中对应字段值是一样的

## kDexTypeStringIdItem

对应DexHeader中的stringIdsSize与stringIdsOff字段，表示从0x70位置起有连续0x14个DexStringId:

````c++
struct DexStringId {
    u4 stringDataOff;      /* file offset to string_data_item */
};
````

他只有一个stringDataOff字段，指向字符串数据的偏移位置，开始地址为0x70+(14*4)=0xc0,所以我们最后一个dexStringId的偏移为：0xbc，我们根据此信息整理了所以字符串:

| dexStringId偏移 | 真实字符串偏移 | 字符串                       | 索引   |
| ------------- | ------- | ------------------------- | ---- |
| 0x70          | 0x16c   | `<init>`                  | 0x0  |
| 74            | 174     | Hello World               | 1    |
| 78            | 181     | L                         | 2    |
| 7c            | 184     | LHelloWorld;              | 3    |
| 80            | 192     | LL                        | 4    |
| 84            | 196     | Ljava/io/PrintStream;     | 5    |
| 88            | 1ad     | Ljava/lang/Object;        | 6    |
| 8c            | 1c1     | Ljava/lang/String;        | 7    |
| 90            | 1d5     | Ljava/lang/StringBuilder; | 8    |
| 94            | 1f0     | Ljava/lang/System;        | 9    |
| 98            | 204     | V                         | a    |
| 9c            | 207     | VL                        | b    |
| a0            | 20b     | [Ljava/lang/String;       | c    |
| a4            | 220     | append                    | d    |
| a8            | 282     | args                      | e    |
| ac            | 22e     | main                      | f    |
| b0            | 234     | out                       | 10   |
| b4            | 239     | println                   | 11   |
| b8            | 242     | toString                  | 12   |
| bc            | 24c     | 这是一个手写的smali实例            | 13   |

## kDexTypeTypeIdItem

他对应DexHeader中的typeIdsSize和typeIdsOff字段，指向的结构体为：

```c++
struct DexTypeId {
    u4  descriptorIdx;      /* 指向DexStringId列表的索引 */
};
```

对应的字符串代表具体的类型，我们根据上面字段可知：从0xc0起有0x8个DexTypeId结构：

| 类型索引 | 字符串索引 | 字符串                       | DexTypeId偏移 |
| :--- | ----- | ------------------------- | ----------- |
| 0    | 0x3   | LHelloWorld;              | 0xc0        |
| 1    | 0x5   | Ljava/io/PrintStream;     | 0xc4        |
| 2    | 0x6   | Ljava/lang/Object;        | 0xc8        |
| 3    | 0x7   | Ljava/lang/String;        | 0xcc        |
| 4    | 0x8   | Ljava/lang/StringBuilder; | 0xd0        |
| 5    | 0x9   | Ljava/lang/System;        | 0xd4        |
| 6    | 0xa   | L                         | 0xd8        |
| 7    | 0xc   | [Ljava/lang/String;       | 0xdc        |

## kDexTypeProtoIdItem

对应DexHeader中的protoIdsSize与protoIdsOff字段，声明如果：

```c++
struct DexProtoId {
    u4  shortyIdx;          /* 指向DexStringId列表的索引 */
    u4  returnTypeIdx;      /* 指向DexTypeId列表的索引 */
    u4  parametersOff;      /* 指向DexTypeList的偏移 */
};
```

他是一个方法的声明结构体，shortyIdx为方法声明字符串，returnTypeIdx为方法返回类型字符串，parametersOff指向一个DexTypeList的结构体存放了方法的参数列表

```c++
struct  {
    u4  size;               /* 接下来DexTypeItem的个数 */
    DexTypeItem list[1];    /* DexTypeItem结构 */
};
```

DexTypeItem声明：

```c++
struct DexTypeItem {
    u2  typeIdx;            /* 指向DexTypeId列表的索引 */
};
```

根据上面的信息我们得知从0xe0开始有0x5个DexProtoId对象

| 索引   | 方法声明 | 返回类型                      | 参数列表                | paramOff偏移 |
| ---- | ---- | ------------------------- | ------------------- | ---------- |
| 0    | L    | Ljava/lang/String;        | 无参数                 | 0          |
| 1    | LL   | Ljava/lang/StringBuilder; | Ljava/lang/String;  | 0x278      |
| 2    | V    | L                         | 无参数                 |            |
| 3    | VL   | L                         | Ljava/lang/String;  | 0x278      |
| 4    | VL   | L                         | [Ljava/lang/String; | 0x270      |

## kDexTypeFieldIdItem

对应DexHeader中的fieldIdsSize和fieldIdsOff字段，指向DexFieldId结构体

```c++
struct DexFieldId {
    u2  classIdx;           /* 类的类型，指向DexTypeId列表索引 */
    u2  typeIdx;            /* 字段类型，指向DexTypeId列表索引 */
    u4  nameIdx;            /* 字段名，指向DexStringId列表 */
};
```

可以看见这个结构的数据全部是索引信息，指明了字段所在的类，字段类型，字段名，通过上面的信息我们发现从0x11c有一个kDexTypeFieldIdItem

| 类类型                | 字段类型                  | 字段名  |
| ------------------ | --------------------- | ---- |
| Ljava/lang/System; | Ljava/io/PrintStream; | out  |

## kDexTypeMethodIdItem

它对应DexHeader中的methodIdsSize与methodIdsOff字段，指向的结构体DexMethodId

```c++
struct DexMethodId {
    u2  classIdx;           /* 类的类型，指向DexTypeId列表的索引 */
    u2  protoIdx;           /* 声明类型，指向DexProtoId列表索引 */
    u4  nameIdx;            /* 方法名，指向DexStringId列表的索引 */
};
```

数据也是索引，指明了方法所在的类，方法声明和方法名。从0x124有0x5个kDexTypeMethodIdItem

| 类类型                       | 方法声明 | 方法名      |
| ------------------------- | ---- | -------- |
| LHelloWorld;              | VL   | main     |
| Ljava/io/PrintStream;     | VL   | println  |
| Ljava/lang/StringBuilder; | V    | `<init>` |
| Ljava/lang/StringBuilder; | LL   | append   |
| Ljava/lang/StringBuilder; | L    | toString |

## kDexTypeClassDefItem

对应DexHeader中的classDefsSize和classDefsOff字段，指向结构体DexClassDef

```c++
struct DexClassDef {
    u4  classIdx;           /* 类的类型，指向DexTypeId列表索引 */
    u4  accessFlags;        /* 访问标志 */
    u4  superclassIdx;      /* 父类的类型，指向DexTypeId列表的索引 */
    u4  interfacesOff;      /* 实现了哪些接口，指向DexTypeList结构的偏移 */
    u4  sourceFileIdx;      /* 源文件名，指向DexStringId列表的索引 */
    u4  annotationsOff;     /* 注解，指向DexAnnotationsDirectoryItem结构的偏移 */
    u4  classDataOff;       /* 指向DexClassData结构的偏移 */
    u4  staticValuesOff;    /* 指向DexEncodedArray结构的偏移 */
};
```

classIdx是一个索引值，表示类的类型

accessFlags是类的访问标志，他是以ACC_开头的枚举值

superclassIdx是父类的类型

interfacesOff如果类含有接口声明或实现，他就会指向一个DexTypeList结构，否则为0

sourceFileIdx是类所在源文件名称

annotationsOff字段指向注解目录结构，根据类型不同有注解类，注解方法，注解字段，注解参数。如果没有注解，值为0

classDataOff指向DexClassData结构，是类的数据部分

staticValuesOff记录了类中的静态数据

### DexClassData

声明在DexClass.h中

```c++
struct DexClassData {
    DexClassDataHeader header; //指向DexClassDataHeader，字段和方法个数
    DexField*          staticFields; //静态字段
    DexField*          instanceFields; //实例字段
    DexMethod*         directMethods; //直接方法
    DexMethod*         virtualMethods;//虚方法
};
```

#### DexClassDataHeader

记录了当前类中的字段和方法的数目，声明如下：

```c++
struct DexClassDataHeader {
    u4 staticFieldsSize; //静态字段个数
    u4 instanceFieldsSize;//实例字段个数
    u4 directMethodsSize;//直接方法个数
    u4 virtualMethodsSize;//虚方法个数
};
```

#### DexField

描述了字段类型与访问标志，声明如下:

```c++
struct DexField {
    u4 fieldIdx;    /* 指向DexFieldId列表的索引 */
    u4 accessFlags; //访问标志
};
```

#### DexMethod

描述了方法的原型，名称，访问标志和代码数据块，声明如下：

```c++
struct DexMethod {
    u4 methodIdx;    /* 指向DexMethodId列表的索引 */
    u4 accessFlags;
    u4 codeOff;      /* 指向DexCode结构的偏移 */
};
```

codeOff字段指向一个DexCode结构体，声明如下：

/dalvik/libdex/DexFile.h

```c++
struct DexCode {
    u2  registersSize;//使用寄存器个数
    u2  insSize;//参数个数
    u2  outsSize;//调用其他方法时使用的寄存器个数
    u2  triesSize;//try/catch个数
    u4  debugInfoOff;//指向调试信息的偏移
    u4  insnsSize;//指令集个数，以2字节为单位
    u2  insns[1];//指令集
    /* followed by optional u2 padding */
    /* followed by try_item[triesSize] */
    /* followed by uleb handlersSize */
    /* followed by catch_handler_item[handlersSize] */
};
```

registersSize指令了方法使用的寄存器个数，对应smali中的.locals 2

insSize指定了方法的参数个数，对应.param p1, "noteId"    # Ljava/lang/String;

如果一个方法使用5个寄存器，其中2有两个参数寄存器，而该方法调用另一个方法使用了20个寄存器，那么虚拟机在分配该方法寄存器是会在分配20个寄存器

triesSize指定了方法中Try/Catch格式

debugInfoOff指向调试信息偏移，如果有，解析函数为dexDecodoDebugInfo在DexDebugInfo.cpp文件

insnsSize接下来指令个数

insns真正的代码部分

根据上面的信息，我们发现从0x14c有0x1个kDexTypeClassDefItem：

第一个字段值为0x0,表示对应DexType中的索引为0，值为LHelloWorld;，表示类名为HelloWorld

第二个字段值为0x1表示访问标识符为ACC_PUBLIC

第三个字段值0x2表示父类，表示指向DexType的索引，值为Ljava/lang/Object;，表示父类为java/lang/Object;

第四个字段值0x0,表示没有接口

第五个字段值

第六个字段值0x0表示没有注解

第七个字段值0x2f0表示DexClassData的偏移

第八个字段值0x0表示没有静态值



我们继续分析DexClassData

DexClassDataHeader为4个uleb128数据类型，从0x2f0开始值为：0，0，1，0，表示静态字段为0个，实例字段为0个，1个直接方法，0个虚方法

由于没有静态字段，实例字段，虚方法，所以我们直接分析DexMethod

从0x2f4开始为一个直接方法相关数据，第一个字段为0，指向的DexMethod列表第0个，也就是main方法。第二个值09，表示public+static，具体的看下面表：

现在来说下accessFlags在字节码中的计算方式：
access_flags的计算公式为：access_flags = flagA | flagB | flagB ...

| 标志名称          | 标志值    | 含义          |
| ------------- | ------ | ----------- |
| ACC_PUBLIC    | 0x0001 | public      |
| ACC_PRIVATE   | 0x0002 | private     |
| ACC_PROTECTED | 0x0004 | protected   |
| ACC_STATIC    | 0x0008 | static      |
| ACC_FINAL     | 0x0010 | final       |
| ACC_VOLATILE  | 0x0040 | volatile    |
| ACC_TRANSIENT | 0x0080 | transient   |
| ACC_SYNTHETIC | 0x1000 | 是否是编译器自动生成的 |
| ACC_ENUM      | 0x4000 | enum        |

第三个字段为90 05，值为0x290，我们从0x290开始分析DexCode，值为：

0b 00=11

01 00=1

02 00=2

00 00=0

表示使用了11个寄存器，1个参数寄存器，调用其他方法使用了2个寄存器，没有Try/Catch

88 02 00 00=0x288,debugInfoOff

28 00 00 00=0x28,insnsSize，指令个数，以2字节为单位

我们先读取一个两个字节6200，查看[dalvik bytecode](https://source.android.com/devices/tech/dalvik/dalvik-bytecode.html)发现为sget-object,指令格式为21c,查询[instruction formats](https://source.android.com/devices/tech/dalvik/instruction-formats.html)可以看到指令格式为：

AA|op BBBB

可以看出他需要两个16位，21C对应有以下几种格式：

| op vAA, type@BBBB   | check-cast   |
| ------------------- | ------------ |
| op vAA, field@BBBB  | const-class  |
| op vAA, string@BBBB | const-string |

由于我们的指令是sget，所有这条指令格式为op vAA, field@BBBB

在读取两个字节0000，表示在字段索引0，所以这条指令为

sget-object v0, Ljava/lang/System;->out:Ljava/io/PrintStream;

继续从0x2a4分析：

00 00，查看bytecode为10x,在查询指令格式为：

ØØ|op	10x	op，可以看出只需要两个字节，所以这条指令为：nop

00 00：nop

00 00：nop

12 32:op=12,A=2,B=3查询字节码代码格式，const/4 vA, #+B，格式为11n，最终翻译为：const/4 v2, 0x3

13 03：op=13,const/16 vAA, #+BBBB,格式21s，格式为AA|op BBBB，所以需要两个字节，在读取两个字节，ff ff，最终指令格式为：const/16 v3, -0x1

剩下的指令可以按照上面的步骤翻译完

18 04：

const-wide vAA, #+BBBBBBBBBBBBBBBB

AA|op 
BBBBlo BBBB BBBB BBBBhi

0000 0100 0000 0000
每两位调换位置：
0000 0010 0000 0000
从低位到高位排列
0000 0000 0010 0000

最后这条指令为：

const-wide v4, 0x100000








































