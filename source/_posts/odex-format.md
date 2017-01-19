---
title: odex文件详解
date: 2016-08-04 22:19:25
categories: Dalvik
tags: 
    - odex
---

# 为什么有odex

因为apk实际为zip压缩包，虚拟机每次加载都需要从apk中读取classes.dex文件，这样会耗费很多的时间，而如果采用了odex方式优化的dex文件，他包含了加载dex必须的依赖库文件列表，只需要直接加载而不需要再去解析。

# 如何生成odex文件

他有两种存在方式：

一种是从apk程序提取出来了的与apk放在同一目录且后缀为odex,这类odex多事Android ROM的程序

另一种是保存在/data/dalvik-cache/目录下的缓存文件，这类odex文件仍然以dex作为后缀，文件名为apk路径@apk名称@classes.dex,如：

system@app@Email.apk@classes.dex：安装在system/app目录下面的Email.apk

> 上面说的都是由系统自动生成的，我们下面说说怎么手动生成

首先在Android的源码里面提供了一个dexopt-wrapper，在build/tools/dexpreopt/dexopt-wrapper/目录下，查看了DexOptWrapper.cpp文件发现他最终调用的是/system/bin/dexopt命令。所以说我们可以自己编译或者下载一个dexopt-wrapper到手机，就可以手动将dex转为odex了

```shell
adb push dexopt-wrapper /data/local/
adb shell chmod 777 /data/local/dexopt-wrapper
```

接下来把我们前面写的HelloWorld.smali编译成dex为classes.dex在打包为HelloWorld.zip，并push到手机

```shell
adb push HelloWorld.zip /data/local/
```

下面我们进入到/data/local/目录下面执行

```
./dexopt-wrapper HelloWorld.zip HelloWorld.odex
```

不出意外的话会输出：

```
--- BEGIN 'HelloWorld.zip' (bootstrap=0) ---
--- waiting for verify+opt, pid=2535
--- would reduce privs here
--- END 'HelloWorld.zip' (success) ---
```

说明转换成功了，我们将HelloWorld.odex下载到本地，以便后面的分析

```
adb pull /data/local/HelloWorld.odex .
```

# odex文件整体结构

odex可以理解为一个dex文件的超集，因为他包含完整的dex数据，不过他文件的写入和读取并没有像dex文件哪有定义全部的数据结构，只能通过查看源码分析，dalvik虚拟机最终将dex文件映射到内存中后是DexFile格式，我们查看他的定义：

```c++
struct DexFile {
    /* directly-mapped "opt" header */
    const DexOptHeader* pOptHeader;

    /* pointers to directly-mapped structs and arrays in base DEX */
    const DexHeader*    pHeader;
    const DexStringId*  pStringIds;
    const DexTypeId*    pTypeIds;
    const DexFieldId*   pFieldIds;
    const DexMethodId*  pMethodIds;
    const DexProtoId*   pProtoIds;
    const DexClassDef*  pClassDefs;
    const DexLink*      pLinkData;

    /*
     * These are mapped out of the "auxillary" section, and may not be
     * included in the file.
     */
    const DexClassLookup* pClassLookup;
    const void*         pRegisterMapPool;       // RegisterMapClassPool

    /* points to start of DEX file data */
    const u1*           baseAddr;

    /* track memory overhead for auxillary structures */
    int                 overhead;

    /* additional app-specific data structures associated with the DEX */
    //void*               auxData;
};
```

他存入的多位其他结构的指针。DexOptHeader就是odex的头，DexLink以下的是辅助数据段，也就是dex优化后的添加的数据，dexFile中有些是不会加载进内存的，所以下面就是odex定义个结构：

## ODEXFile

```c++
struct ODEXFile {
    DexOptHeader header; //文件头
    DEXFile dexfile; //dex文件
    Dependences deps; //依赖库列表
    ChunkDexClassLookup lookup; //类索引结构
    ChunkRegisterMapPool mappool; //映射池
    ChunkEnd end; //结束标志位
}
```

## DexOptHeader

他的定义在DexFile.h中

```c++
struct DexOptHeader {
    u1  magic[8]; /* 标识是一个odex文件，包含版本号 */

    u4  dexOffset; /* dex文件的偏移 */
    u4  dexLength; /* dex文件长度 */
    u4  depsOffset; /* odex依赖库的偏移 */
    u4  depsLength; /* 依赖库长度 */
    u4  optOffset; /* 辅助数据偏移 */
    u4  optLength; /* 辅助数据长度 */

    u4  flags; /* 标志位 */
    u4  checksum; /* 依赖库和辅助数据的校验值 */
};
```

mgic：和DexHeader结构中的magic字段类似，标识一个特定类型的文件，当前(Android 4.4,api19)的固定值为64 65 79 0a 30 33 36 00，转为字符串为d   e   y  \n   0   3   6  \0

dexOffset：为dex文件头的偏移，当前的值为DexOptHeader结构大小0x28

flag:取值为DexoptFlags中的常量值，标识了虚拟机加载odex时的优化与验证选项

| 字段名        | 偏移值  | 长度   |
| ---------- | ---- | ---- |
| magic      | 0x0  | 8    |
| dexOffset  | 8    | 4    |
| dexLength  | c    | 4    |
| depsOffset | 10   | 4    |
| depsLength | 14   | 4    |
| optOffset  | 18   | 4    |
| optLength  | 20   | 4    |
| flags      | 24   | 4    |
| checksum   | 28   | 4    |

## DexFile

这一部分和上一篇文章将的格式是一样的

## Dependences

这一部分没有在源码中明确的定义，他不会被加载进内存，只能通过源码分析他的结构

```c++
struct Dependences{
	u4 modWhen; //时间戳
	u4 crc; //校验值
	u4 DALVIK_VM_BUILD; //Dalvik虚拟机版本号
	U4 numDeps; //依赖库个数
	struct{
		u4 len; //name字符串长度
		u1 name[len]; //依赖库名称
		kSHA1DigestLen signature; //sha-1值,20，在DexFile.h中定义
	} table[numDeps];
}
```

下面我们从源码分析生成Dependences结构的代码，是由/dalvik/vm/analysis/DexPrepare.cpp#writeDependencies中完成的

```c++
static int writeDependencies(int fd, u4 modWhen, u4 crc)
{
    u1* buf = NULL;
    int result = -1;
    ssize_t bufLen;
    ClassPathEntry* cpe;
    int numDeps;

    /*
     * Count up the number of completed entries in the bootclasspath.
     */
    numDeps = 0;
    bufLen = 0;
    for (cpe = gDvm.bootClassPath; cpe->ptr != NULL; cpe++) { //计算依赖库个数
        const char* cacheFileName =
            dvmPathToAbsolutePortion(getCacheFileName(cpe));
        assert(cacheFileName != NULL); /* guaranteed by Class.c */

        ALOGV("+++ DexOpt: found dep '%s'", cacheFileName);

        numDeps++; //依赖库格式
        bufLen += strlen(cacheFileName) +1;
    }

    bufLen += 4*4 + numDeps * (4+kSHA1DigestLen);

    buf = (u1*)malloc(bufLen); //动态开辟Dependencies结构的长度

    set4LE(buf+0, modWhen); //写入时间戳
    set4LE(buf+4, crc); //写入crc
    set4LE(buf+8, DALVIK_VM_BUILD); //写入虚拟机版本
    set4LE(buf+12, numDeps); //写入依赖库的个数

    // TODO: do we want to add dvmGetInlineOpsTableLength() here?  Won't
    // help us if somebody replaces an existing entry, but it'd catch
    // additions/removals.

    u1* ptr = buf + 4*4;
    for (cpe = gDvm.bootClassPath; cpe->ptr != NULL; cpe++) { //循环写入所有依赖库
        const char* cacheFileName =
            dvmPathToAbsolutePortion(getCacheFileName(cpe));
        assert(cacheFileName != NULL); /* guaranteed by Class.c */

        const u1* signature = getSignature(cpe);//计算sha1值
        int len = strlen(cacheFileName) +1;

        if (ptr + 4 + len + kSHA1DigestLen > buf + bufLen) {
            ALOGE("DexOpt: overran buffer");
            dvmAbort();
        }

        set4LE(ptr, len);
        ptr += 4;
        memcpy(ptr, cacheFileName, len); //写入依赖库的名词
        ptr += len;
        memcpy(ptr, signature, kSHA1DigestLen); //写入依赖库的sha1值
        ptr += kSHA1DigestLen;
    }

    assert(ptr == buf + bufLen);

    result = sysWriteFully(fd, buf, bufLen, "DexOpt dep info");

    free(buf);
    return result;
}
```

modWhen:记录优化前classes.dex的时间戳

crc:优化前classes.dex的校验值

他们是通过/dalvik/libdex/ZipArchive.cpp#dexZipGetEntryInfo函数来获取的



DALVIK_VM_BUILD：是虚拟机版本号，定义在/dalvik/vm/DalvikVersion.h

```c++
#define DALVIK_VM_BUILD         27
```

2.2.3 = 19

2.3~2.3.7 = 23

4.0~5.1.1 = 27

6.0.0~后面没有这个常量了



numDeps:依赖库个数

table：为连续numDeps个真实依赖信息结构组成

​	len:指定第2个字段name暂用的字节数

​	name:依赖库的完整路径名

​	signature:依赖库的sha1值



下面我们就用上次的HelloWorld.odex来分析Dependences结构并验证上述是否正确：

首先我们读取depsOffset字段值：0x3d0，depsLength值为：0x373，所以我们计算可知，依赖结构暂用的偏移为0x3d0~0x743



继续从0x3d0分析：

读取4个字节：

modWhen=55 67 f9 48

crc=ec 48 c7 05

DALVIK_VM_BUILD=1b 00 00 00=27

numDeps=0f 00 00 00=15



根据上面的信息我们分析所以得依赖如下：

我们手动分析一个依赖

读取0x3e0 ，值为：1c 00 00 00，表示文件吗长度为0x1c,我们读取28个字符值为/system/framework/core.odex，这就是完整文件名，从0x400读取20位，值为d6 bb 96 dc 78 1a 55 38  f2 6d b5 d5 84 5a 6e 64 87 a6 35 72，这就是依赖库的sha-1值，根据上面的步骤，我们分析出所有的依赖信息

| 序号   | 文件吗长度 | 依赖库名称                                   | sha1                                     |
| ---- | ----- | --------------------------------------- | ---------------------------------------- |
| 0    | 0x1c  | /system/framework/core.odex             | d6bb96dc781a5538f26db5d5845a6e6487a63572 |
| 1    | 0x21  | /system/framework/conscrypt.odex        | 1f33546e3ca68e8c3ba1c111a47e1b08ee4854cd |
| 2    | 1e    | /system/framework/okhttp.odex           | 30372c6bfffddac82b262ccd85bbbe00fe119a35 |
| 3    | 22    | /system/framework/core-junit.odex       | 468e68afd635b716c77a1ade97e6ac906f995057 |
| 4    | 24    | /system/framework/bouncycastle.odex     | 7b93bde38862bf719b9f4054b91522d8d3647d91 |
| 5    | 1b    | /system/framework/ext.odex              | 65d2a8066071edff6d5c67eef0fac632cfef23b0 |
| 6    | 21    | /system/framework/framework.odex        | 4b43246e783414fa0537c9a3560874dad17467b6 |
| 7    | 22    | /system/framework/framework2.odex       | 4d752b219a4b4309ca154ed7135cc76857fde3aa |
| 8    | 28    | /system/framework/telephony-common.odex | 3011022a0fd5bd01b45f47927410f116d3fb7eac |
| 9    | 23    | /system/framework/voip-common.odex      | c4e5082b04e40b8a63f4fcb03c5e65c5b0ac632a |
| 10   | 22    | /system/framework/mms-common.odex       | 4c2d0a0b65dd9a8cc7d68474076588356b16fbab |
| 11   | 26    | /system/framework/android.policy.odex   | 659f32295f35fbbdd88db6019fec7313000c3ece |
| 12   | 20    | /system/framework/services.odex         | 7534cc6d79d1d9464bd45dfe0a976ceb94b3ceae |
| 13   | 22    | /system/framework/apache-xml.odex       | 289e934d21ca9a5c99d6e52dd6024274cbebfdce |
| 14   | 27    | /system/framework/webviewchromium.odex  | 1305e97aaf378db3d94acdc88beddec0aa9feed8 |

## 辅助数据

ChunkDexClassLookup，ChunkRegisterMapPool,ChunkEnd这个三个Chunk快，他们被Dalvik虚拟机加载到一个称为auxiliary的端中，他们都是由DexPrepare.cpp#writeOptData

```c++
static bool writeOptData(int fd, const DexClassLookup* pClassLookup,
    const RegisterMapBuilder* pRegMapBuilder)
{
    /* 写入DexChunkClassLookup数据库 */
    if (!writeChunk(fd, (u4) kDexChunkClassLookup,
            pClassLookup, pClassLookup->size))
    {
        return false;
    }

    /* 写入DexChunkRegisterMaps(可选) */
    if (pRegMapBuilder != NULL) {
        if (!writeChunk(fd, (u4) kDexChunkRegisterMaps,
                pRegMapBuilder->data, pRegMapBuilder->size))
        {
            return false;
        }
    }

    /* 写入DexChunkEnd */
    if (!writeChunk(fd, (u4) kDexChunkEnd, NULL, 0)) {
        return false;
    }

    return true;
}
```

可以看到数据其实是通过writeChunk函数写入的

```c++
static bool writeChunk(int fd, u4 type, const void* data, size_t size)
{
    union {             /* save a syscall by grouping these together */
        char raw[8];
        struct {
            u4 type;
            u4 size;
        } ts;
    } header;

    assert(sizeof(header) == 8);

    ALOGV("Writing chunk, type=%.4s size=%d", (char*) &type, size);

    header.ts.type = type;
    header.ts.size = (u4) size;
    if (sysWriteFully(fd, &header, sizeof(header),
            "DexOpt opt chunk header write") != 0)
    {
        return false;
    }

    if (size > 0) {
        if (sysWriteFully(fd, data, size, "DexOpt opt chunk write") != 0)
            return false;
    }

    /* if necessary, pad to 64-bit alignment */
    if ((size & 7) != 0) {
        int padSize = 8 - (size & 7);
        ALOGV("size was %d, inserting %d pad bytes", size, padSize);
        lseek(fd, padSize, SEEK_CUR);
    }

    assert( ((int)lseek(fd, 0, SEEK_CUR) & 7) == 0);

    return true;
}
```

可以看到函数中定义了一个共同体Header，共暂用8字节，写入时会根据具体的结构填充这个结构，type字段为1一个以KDexChunk开头的枚举，在DexFile.h中定义如下

```c++
enum {
    kDexChunkClassLookup            = 0x434c4b50,   /* CLKP */
    kDexChunkRegisterMaps           = 0x524d4150,   /* RMAP */

    kDexChunkEnd                    = 0x41454e44,   /* AEND */
};
```

size是要填充的数据的字节数。

### ChunkClassLookup

写入DexChunkClassLookup时向writeChunk函数传递了一个DexClassLookup结构指针，在DexFile.h定义如下：

```c++
struct DexClassLookup {
    int     size;                       // total size, including "size"
    int     numEntries;                 // size of table[]; always power of 2
    struct {
        u4      classDescriptorHash;    // class descriptor hash code
        int     classDescriptorOffset;  // in bytes, from start of DEX
        int     classDefOffset;         // in bytes, from start of DEX
    } table[1];
};
```

虚拟机通过DexClassLookup结构来检索所有类

size:为本结构体的字节数

numEntries：接下来table结构的项数，值为2

table:是用来描述类的信息

​	classDescriptorHash：为类的hash值

​	classDescriptorOffset：类的描述

​	classDefOffset：为指向DexClassDef结构体的指针的偏移

根据上面我们可以分析出ChunkDexClassLookup的结构为

```c++
struct ChunkDexClassLookup {
	Header header; //这个就是writeChunk函数中定义的header
	DexClassLoopup lookup;
}
```

### ChunkRegisterMapPool

写入他时像writeChunk函数传递了一个RegisterMapBuilder结构，定义在/dalvik/vm/analysis/RegisterMap.h中

```c++
struct RegisterMapBuilder {
    /* public */
    void*       data;
    size_t      size;

    /* private */
    MemMapping  memMap;
};
```

//TODO

### ChunkEnd

写入他时向writeChunk函数传递了一个NULL指针，并且传递了kDexChunkEnd类型，所以他只有一个header，最后得出结构如下：

```c++
struct ChunkEnd {
   	Header header;
};
```





























