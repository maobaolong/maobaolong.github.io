---
title: 深入到源码解析leb128数据类型
date: 2016-07-23 11:53:44
categories: Dalvik
tags: 
    - leb128
---

# 什么是leb

LEB128即"Little-Endian Base 128"，基于128的小印第安序编码格式，是对任意有符号或者无符号整型数的可变长度的编码。

也即，用LEB128编码的正数，会根据数字的大小改变所占字节数。在android的.dex文件中，他只用来编码32bits的整型数。

那什么是leb呢：LITTLE-ENDIAN（小字节序、低字节序）,即低位字节排放在内存的低地址端，高位字节排放在内存的高地址端。 与之对应的是：BIG-ENDIAN（大字节序、高字节序）

# 特点

每个LEB128由1~5字节组成，所有的字节组合在一起表示一个32位的数据，第一个的最高位为1，表示他还需要第二个字节，但是我们看第二个字节的最高位发现他是0，所以他不需要第三个字节了，如下图


<table class="leb128Bits">
<thead>
<tr><th colspan="16">Bitwise diagram of a two-byte LEB128 value</th></tr>
<tr>
  <th colspan="8">First byte
  </th><th colspan="8">Second byte
</th></tr>
</thead>
<tbody>
<tr>
  <td class="start1"><code>1</code></td>
  <td>bit<sub>6</sub></td>
  <td>bit<sub>5</sub></td>
  <td>bit<sub>4</sub></td>
  <td>bit<sub>3</sub></td>
  <td>bit<sub>2</sub></td>
  <td>bit<sub>1</sub></td>
  <td>bit<sub>0</sub></td>
  <td class="start2"><code>0</code></td>
  <td>bit<sub>13</sub></td>
  <td>bit<sub>12</sub></td>
  <td>bit<sub>11</sub></td>
  <td>bit<sub>10</sub></td>
  <td>bit<sub>9</sub></td>
  <td>bit<sub>8</sub></td>
  <td class="end2">bit<sub>7</sub></td>
</tr>
</tbody>
</table>

# 读取leb128

/dalvik/libdex/Leb128.h

## 读取uleb128

读取无符号leb128的实现，可以在上面给的源码路径下看到如下方法：

```c++
DEX_INLINE int readUnsignedLeb128(const u1** pStream) {
    const u1* ptr = *pStream;
    int result = *(ptr++); //取第一个字节

    if (result > 0x7f) {  //如果第1个字节大于0x7f,表示第一个字节最高位为1
        int cur = *(ptr++);  //第2个字节
        result = (result & 0x7f) | ((cur & 0x7f) << 7); //与0x7f表示去掉这个这个字节的第8位。
        if (cur > 0x7f) {
            cur = *(ptr++);
            result |= (cur & 0x7f) << 14;
            if (cur > 0x7f) {
                cur = *(ptr++);
                result |= (cur & 0x7f) << 21;
                if (cur > 0x7f) {
                    /*
                     * Note: We don't check to see if cur is out of
                     * range here, meaning we tolerate garbage in the
                     * high four-order bits.
                     */
                    cur = *(ptr++);
                    result |= cur << 28;
                }
            }
        }
    }

    *pStream = ptr;
    return result;
}
```

下面举例子：计算c0 83 92 25的uleb128值
  1100 0000 0xc0 //最高位为1，表示还需要第2个字节
 +0111 1111
 ----------
  0100 0000 0x40 //第一个字节的值

  1000 0011 0x83 //最高位为1，表示还需要第3个字节
 +0111 1111
 ----------
  0000 0011 0x3 << 7 = 0x180 //第2个字节的值


  1001 0010 0x92 //最高位为1，表示还需要第4个字节
 +0111 1111
 ----------
  0001 0010 0x12 << 14 = 0x48000,294912 //第3个字节的值


  0010 0101 0x25
 +0111 1111
 ----------
  0010 0101 0x25 << 21 = 0x4a00000,37x2^21 //第4个字节的值

  结果为：0x4a481c0

至于为什么要左移7，14位等，是因为这里所示的字节码是先排列低位字节码，所以第2个字节，应该在左边，依次类推


## 读取sleb128类型

计算方法与无符号的leb128是一样的，只是对无符号leb128最后一个字节的最高位进行了符号扩展

```c++
 DEX_INLINE int readSignedLeb128(const u1** pStream) {
    const u1* ptr = *pStream;
    int result = *(ptr++);

    if (result <= 0x7f) {
        result = (result << 25) >> 25;
    } else {
        int cur = *(ptr++);
        result = (result & 0x7f) | ((cur & 0x7f) << 7);
        if (cur <= 0x7f) {
            result = (result << 18) >> 18;
        } else {
            cur = *(ptr++);
            result |= (cur & 0x7f) << 14;
            if (cur <= 0x7f) {
                result = (result << 11) >> 11;
            } else {
                cur = *(ptr++);
                result |= (cur & 0x7f) << 21;
                if (cur <= 0x7f) {
                    result = (result << 4) >> 4;
                } else {
                    /*
                     * Note: We don't check to see if cur is out of
                     * range here, meaning we tolerate garbage in the
                     * high four-order bits.
                     */
                    cur = *(ptr++);
                    result |= cur << 28;
                }
            }
        }
    }

    *pStream = ptr;
    return result;
}
```

下面举例子：计算d1 c2 b3 40的sleb128值

  1101 0001 0xd1
  0111 1111
 ----------
  0101 0001 0x51

  1100 0010 0xc2
 +0111 1111
 ----------
  0100 0010 0x42,66*2^7=0x2100

  1011 0011 0xb3
 +0111 1111
 ----------
  0011 0011 0x33,51*2^14=0xcc000

  0100 0000 0x40
 +0111 1111
 ----------
  0100 0000 0x40,64*2^21=0x8000000


把他没的结果加起来：
0x51+0x2100+0xcc000+0x8000000=0x80ce151,135061841*2^4=2160989456,在除以2^4
























