---
title: 详解gcc的四个编译步骤
date: 2016-08-10 11:16:21
categories: Gcc
tags: 
    - gcc
    - 编译步骤
---
# 简介

GNU编译器套件（GNU Compiler Collection），他提供了包括C、C++、Objective-C、Fortran、Java、Ada和Go语言的编译器，也包括了这些语言的库（如libstdc++、libgcj等等）。GCC的初衷是为GNU操作系统专门编写的一款编译器。GNU系统是彻底的自由软件。此处，“自由”的含义是它尊重用户的自由。

# gcc基本使用

一般的命令格式为：gcc [选项] 需要编译的文件 [选项] [编译后的文件]

如：我们编译一个hello.c程序

```
gcc hello.c #生成a.out 
gcc -o hello hello.c #生成hello,gcc hello.c -o hello
```

上面这一条指令其实执行了四个步骤，预处理，汇编，编译，链接。下面我们一步一步来分析下他每步完成了什么

# 预处理

处理预处理指令，他会把#include包含的头文件都拷贝进来，#defin，#if。可以通过-E来查看这一步

```
gcc -E hello.c -o hello.i
```

生成的hello.i文件内容如下

```c
# 1 "hello.c"
# 1 "<built-in>"
# 1 "<command-line>"
# 1 "hello.c"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h" 1
# 49 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/cdefs.h" 1
# 77 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/cdefs.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/cdefs_elf.h" 1
# 78 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/cdefs.h" 2
# 547 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/cdefs.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/android/api-level.h" 1
# 548 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/cdefs.h" 2
# 50 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h" 2
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h" 1
# 33 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stddef.h" 1 3 4
# 147 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stddef.h" 3 4
typedef int ptrdiff_t;
# 212 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stddef.h" 3 4
typedef unsigned int size_t;
# 34 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h" 2
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h" 1
# 31 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stddef.h" 1 3 4
# 324 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stddef.h" 3 4
typedef unsigned int wchar_t;
# 32 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h" 2
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/_types.h" 1
# 40 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/_types.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/machine/_types.h" 1
# 39 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/machine/_types.h"
typedef signed char __int8_t;
typedef unsigned char __uint8_t;
typedef short __int16_t;
typedef unsigned short __uint16_t;
typedef int __int32_t;
typedef unsigned int __uint32_t;

typedef long long __int64_t;

typedef unsigned long long __uint64_t;


typedef __int8_t __int_least8_t;
typedef __uint8_t __uint_least8_t;
typedef __int16_t __int_least16_t;
typedef __uint16_t __uint_least16_t;
typedef __int32_t __int_least32_t;
typedef __uint32_t __uint_least32_t;
typedef __int64_t __int_least64_t;
typedef __uint64_t __uint_least64_t;


typedef __int32_t __int_fast8_t;
typedef __uint32_t __uint_fast8_t;
typedef __int32_t __int_fast16_t;
typedef __uint32_t __uint_fast16_t;
typedef __int32_t __int_fast32_t;
typedef __uint32_t __uint_fast32_t;
typedef __int64_t __int_fast64_t;
typedef __uint64_t __uint_fast64_t;


typedef int __intptr_t;
typedef unsigned int __uintptr_t;


typedef __int64_t __intmax_t;
typedef __uint64_t __uintmax_t;


typedef __int32_t __register_t;


typedef unsigned long __vaddr_t;
typedef unsigned long __paddr_t;
typedef unsigned long __vsize_t;
typedef unsigned long __psize_t;


typedef int __clock_t;
typedef int __clockid_t;
typedef long __ptrdiff_t;
typedef int __time_t;
typedef int __timer_t;

typedef __builtin_va_list __va_list;






typedef int __wchar_t;

typedef int __wint_t;
typedef int __rune_t;
typedef void * __wctrans_t;
typedef void * __wctype_t;
# 41 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/_types.h" 2

typedef unsigned long __cpuid_t;
typedef __int32_t __dev_t;
typedef __uint32_t __fixpt_t;
typedef __uint32_t __gid_t;
typedef __uint32_t __id_t;
typedef __uint32_t __in_addr_t;
typedef __uint16_t __in_port_t;
typedef __uint32_t __ino_t;
typedef long __key_t;
typedef __uint32_t __mode_t;
typedef __uint32_t __nlink_t;
typedef __int32_t __pid_t;
typedef __uint64_t __rlim_t;
typedef __uint16_t __sa_family_t;
typedef __int32_t __segsz_t;
typedef __uint32_t __socklen_t;
typedef __int32_t __swblk_t;
typedef __uint32_t __uid_t;
typedef __uint32_t __useconds_t;
typedef __int32_t __suseconds_t;





typedef union {
 char __mbstate8[128];
 __int64_t __mbstateL;
} __mbstate_t;
# 33 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h" 2
# 42 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
typedef __int8_t int8_t;
typedef __uint8_t uint8_t;
typedef __int16_t int16_t;
typedef __uint16_t uint16_t;
typedef __int32_t int32_t;
typedef __uint32_t uint32_t;
typedef __int64_t int64_t;
typedef __uint64_t uint64_t;





typedef int8_t int_least8_t;
typedef int8_t int_fast8_t;

typedef uint8_t uint_least8_t;
typedef uint8_t uint_fast8_t;
# 88 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
typedef int16_t int_least16_t;
typedef int32_t int_fast16_t;

typedef uint16_t uint_least16_t;
typedef uint32_t uint_fast16_t;
# 121 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
typedef int32_t int_least32_t;
typedef int32_t int_fast32_t;

typedef uint32_t uint_least32_t;
typedef uint32_t uint_fast32_t;
# 154 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
typedef int64_t int_least64_t;
typedef int64_t int_fast64_t;

typedef uint64_t uint_least64_t;
typedef uint64_t uint_fast64_t;
# 198 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
typedef int intptr_t;
typedef unsigned int uintptr_t;
# 220 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
typedef uint64_t uintmax_t;
typedef int64_t intmax_t;
# 242 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/_wchar_limits.h" 1
# 243 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h" 2
# 254 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdint.h"
typedef int ssize_t;
# 35 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h" 2


# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/posix_types.h" 1
# 15 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/posix_types.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/stddef.h" 1
# 21 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/stddef.h"
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/compiler.h" 1
# 22 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/stddef.h" 2
# 16 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/posix_types.h" 2
# 32 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/posix_types.h"
typedef struct {
 unsigned long fds_bits [(1024/(8 * sizeof(unsigned long)))];
} __kernel_fd_set;

typedef void (*__kernel_sighandler_t)(int);

typedef int __kernel_key_t;
typedef int __kernel_mqd_t;

# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/asm/posix_types.h" 1
# 15 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/asm/posix_types.h"
typedef unsigned long __kernel_ino_t;
typedef unsigned short __kernel_mode_t;
typedef unsigned short __kernel_nlink_t;
typedef long __kernel_off_t;
typedef int __kernel_pid_t;
typedef unsigned short __kernel_ipc_pid_t;
typedef unsigned short __kernel_uid_t;
typedef unsigned short __kernel_gid_t;
typedef unsigned int __kernel_size_t;
typedef int __kernel_ssize_t;
typedef int __kernel_ptrdiff_t;
typedef long __kernel_time_t;
typedef long __kernel_suseconds_t;
typedef long __kernel_clock_t;
typedef int __kernel_timer_t;
typedef int __kernel_clockid_t;
typedef int __kernel_daddr_t;
typedef char * __kernel_caddr_t;
typedef unsigned short __kernel_uid16_t;
typedef unsigned short __kernel_gid16_t;
typedef unsigned int __kernel_uid32_t;
typedef unsigned int __kernel_gid32_t;

typedef unsigned short __kernel_old_uid_t;
typedef unsigned short __kernel_old_gid_t;
typedef unsigned short __kernel_old_dev_t;


typedef long long __kernel_loff_t;


typedef struct {



 int __val[2];

} __kernel_fsid_t;
# 42 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/posix_types.h" 2
# 38 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h" 2
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/asm/types.h" 1
# 17 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/asm/types.h"
typedef unsigned short umode_t;

typedef __signed__ char __s8;
typedef unsigned char __u8;

typedef __signed__ short __s16;
typedef unsigned short __u16;

typedef __signed__ int __s32;
typedef unsigned int __u32;


typedef __signed__ long long __s64;
typedef unsigned long long __u64;
# 39 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h" 2
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/types.h" 1
# 21 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/linux/types.h"
typedef __u16 __le16;
typedef __u16 __be16;
typedef __u32 __le32;
typedef __u32 __be32;

typedef __u64 __le64;
typedef __u64 __be64;


struct ustat {
 __kernel_daddr_t f_tfree;
 __kernel_ino_t f_tinode;
 char f_fname[6];
 char f_fpack[6];
};
# 40 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h" 2
# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/machine/kernel.h" 1
# 34 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/machine/kernel.h"
typedef unsigned long __kernel_blkcnt_t;
typedef unsigned long __kernel_blksize_t;


typedef unsigned long __kernel_fsblkcnt_t;
typedef unsigned long __kernel_fsfilcnt_t;
typedef unsigned int __kernel_id_t;
# 41 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h" 2

typedef __u32 __kernel_dev_t;
# 52 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h"
typedef __kernel_blkcnt_t blkcnt_t;
typedef __kernel_blksize_t blksize_t;
typedef __kernel_clock_t clock_t;
typedef __kernel_clockid_t clockid_t;
typedef __kernel_dev_t dev_t;
typedef __kernel_fsblkcnt_t fsblkcnt_t;
typedef __kernel_fsfilcnt_t fsfilcnt_t;
typedef __kernel_gid32_t gid_t;
typedef __kernel_id_t id_t;
typedef __kernel_ino_t ino_t;
typedef __kernel_key_t key_t;
typedef __kernel_mode_t mode_t;
typedef __kernel_nlink_t nlink_t;


typedef __kernel_off_t off_t;

typedef __kernel_loff_t loff_t;
typedef loff_t off64_t;

typedef __kernel_pid_t pid_t;
# 93 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h"
typedef __kernel_suseconds_t suseconds_t;
typedef __kernel_time_t time_t;
typedef __kernel_uid32_t uid_t;
typedef signed long useconds_t;

typedef __kernel_daddr_t daddr_t;
typedef __kernel_timer_t timer_t;
typedef __kernel_mqd_t mqd_t;

typedef __kernel_caddr_t caddr_t;
typedef unsigned int uint_t;
typedef unsigned int uint;


# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/sysmacros.h" 1
# 36 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/sysmacros.h"
static __inline__ int major(dev_t _dev)
{
  return (_dev >> 8) & 0xfff;
}

static __inline__ int minor(dev_t _dev)
{
  return (_dev & 0xff) | ((_dev >> 12) & 0xfff00);
}

static __inline__ dev_t makedev(int __ma, int __mi)
{
  return ((__ma & 0xfff) << 8) | (__mi & 0xff) | ((__mi & 0xfff00) << 12);
}
# 108 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/sys/types.h" 2


typedef unsigned char u_char;
typedef unsigned short u_short;
typedef unsigned int u_int;
typedef unsigned long u_long;

typedef uint32_t u_int32_t;
typedef uint16_t u_int16_t;
typedef uint8_t u_int8_t;
typedef uint64_t u_int64_t;
# 51 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h" 2



# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stdarg.h" 1 3 4
# 40 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stdarg.h" 3 4
typedef __builtin_va_list __gnuc_va_list;
# 55 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h" 2



# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stddef.h" 1 3 4
# 59 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h" 2


# 1 "/Users/renpingqing/Documents/android/android-ndk-r11c/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/lib/gcc/arm-linux-androideabi/4.9/include/stddef.h" 1 3 4
# 62 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h" 2



typedef off_t fpos_t;
# 74 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h"
struct __sbuf {
 unsigned char *_base;
 int _size;
};
# 106 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h"
typedef struct __sFILE {
 unsigned char *_p;
 int _r;
 int _w;
 short _flags;
 short _file;
 struct __sbuf _bf;
 int _lbfsize;


 void *_cookie;
 int (*_close)(void *);
 int (*_read)(void *, char *, int);
 fpos_t (*_seek)(void *, fpos_t, int);
 int (*_write)(void *, const char *, int);


 struct __sbuf _ext;

 unsigned char *_up;
 int _ur;


 unsigned char _ubuf[3];
 unsigned char _nbuf[1];


 struct __sbuf _lb;


 int _blksize;
 fpos_t _offset;
} FILE;


extern FILE __sF[];

# 210 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h"

void clearerr(FILE *);
int fclose(FILE *);
int feof(FILE *);
int ferror(FILE *);
int fflush(FILE *);
int fgetc(FILE *);
int fgetpos(FILE *, fpos_t *);
char *fgets(char *, int, FILE *);
FILE *fopen(const char *, const char *);
int fprintf(FILE *, const char *, ...);
int fputc(int, FILE *);
int fputs(const char *, FILE *);
size_t fread(void *, size_t, size_t, FILE *);
FILE *freopen(const char *, const char *, FILE *);
int fscanf(FILE *, const char *, ...);
int fseek(FILE *, long, int);
int fseeko(FILE *, off_t, int);
int fsetpos(FILE *, const fpos_t *);
long ftell(FILE *);
off_t ftello(FILE *);
size_t fwrite(const void *, size_t, size_t, FILE *);
int getc(FILE *);
int getchar(void);
char *gets(char *);



extern int sys_nerr;
extern char *sys_errlist[];

void perror(const char *);
int printf(const char *, ...);
int putc(int, FILE *);
int putchar(int);
int puts(const char *);
int remove(const char *);
int rename(const char *, const char *);
void rewind(FILE *);
int scanf(const char *, ...);
void setbuf(FILE *, char *);
int setvbuf(FILE *, char *, int, size_t);
int sprintf(char *, const char *, ...);
int sscanf(const char *, const char *, ...);
FILE *tmpfile(void);
char *tmpnam(char *);
int ungetc(int, FILE *);
int vfprintf(FILE *, const char *, __va_list);
int vprintf(const char *, __va_list);
int vsprintf(char *, const char *, __va_list);


int snprintf(char *, size_t, const char *, ...)
  __attribute__((__format__ (printf, 3, 4)))
  __attribute__((__nonnull__ (3)));
int vfscanf(FILE *, const char *, __va_list)
  __attribute__((__format__ (scanf, 2, 0)))
  __attribute__((__nonnull__ (2)));
int vscanf(const char *, __va_list)
  __attribute__((__format__ (scanf, 1, 0)))
  __attribute__((__nonnull__ (1)));
int vsnprintf(char *, size_t, const char *, __va_list)
  __attribute__((__format__ (printf, 3, 0)))
  __attribute__((__nonnull__ (3)));
int vsscanf(const char *, const char *, __va_list)
  __attribute__((__format__ (scanf, 2, 0)))
  __attribute__((__nonnull__ (2)));



# 289 "/Users/renpingqing/Documents/android/android-ndk-r11c/platforms/android-14/arch-arm/usr/include/stdio.h"





FILE *fdopen(int, const char *);
int fileno(FILE *);


int pclose(FILE *);
FILE *popen(const char *, const char *);



void flockfile(FILE *);
int ftrylockfile(FILE *);
void funlockfile(FILE *);





int getc_unlocked(FILE *);
int getchar_unlocked(void);
int putc_unlocked(int, FILE *);
int putchar_unlocked(int);



char *tempnam(const char *, const char *);










int asprintf(char **, const char *, ...)
  __attribute__((__format__ (printf, 2, 3)))
  __attribute__((__nonnull__ (2)));
char *fgetln(FILE *, size_t *);
int fpurge(FILE *);
int getw(FILE *);
int putw(int, FILE *);
void setbuffer(FILE *, char *, int);
int setlinebuf(FILE *);
int vasprintf(char **, const char *, __va_list)
  __attribute__((__format__ (printf, 2, 0)))
  __attribute__((__nonnull__ (2)));






FILE *funopen(const void *,
  int (*)(void *, char *, int),
  int (*)(void *, const char *, int),
  fpos_t (*)(void *, fpos_t, int),
  int (*)(void *));

# 2 "hello.c" 2

int nums[5] = {1,2,3,4,5};

int for0(int n)
{
    int i = 0;
    int s = 0;
    for(i = 0;i<n;i++)
    {
        s+=i;
    }
    return s;
}

int for1(int n)
{
    int i = 0;
    int s = 0;
    for(i = 0;i<n;i++)
    {
        s+=i*2;
    }
    return s;
}

int for2(int n)
{
    int i = 0;
    int s = 0;
    for(i = 0;i<n;i++)
    {
        s+=i*i+nums[n-1];
    }
    return s;
}

int main(int argc,char* argv[])
{
    printf("hello ARM!\n");
    printf("for0%d\n", for0(5));
    printf("for1%d\n", for1(5));
    printf("for2%d\n", for2(5));
    return 0;
}

```

可以看见他确实包含进来了stdio.h的内容，printf的申明就在其中

# 编译

检查的代码的规范性和语法错误等。确认无误后将.i文件翻译为ARM汇编，可以通过-S查看

```
gcc -S hello.i -o hello.s
```

```assembly
	.arch armv5te
	.fpu softvfp
	.eabi_attribute 20, 1
	.eabi_attribute 21, 1
	.eabi_attribute 23, 3
	.eabi_attribute 24, 1
	.eabi_attribute 25, 1
	.eabi_attribute 26, 2
	.eabi_attribute 30, 6
	.eabi_attribute 34, 0
	.eabi_attribute 18, 4
	.file	"hello.c"
	.global	nums
	.data
	.align	2
	.type	nums, %object
	.size	nums, 20
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
	.section	.rodata
	.align	2
.LC0:
	.ascii	"hello ARM!\000"
	.align	2
.LC1:
	.ascii	"for0%d\012\000"
	.align	2
.LC2:
	.ascii	"for1%d\012\000"
	.align	2
.LC3:
	.ascii	"for2%d\012\000"
	.text
	.align	2
	.global	main
	.type	main, %function
main:
	@ args = 0, pretend = 0, frame = 8
	@ frame_needed = 1, uses_anonymous_args = 0
	stmfd	sp!, {fp, lr}
	add	fp, sp, #4
	sub	sp, sp, #8
	str	r0, [fp, #-8]
	str	r1, [fp, #-12]
	ldr	r3, .L17
.LPIC1:
	add	r3, pc, r3
	mov	r0, r3
	bl	puts(PLT)
	mov	r0, #5
	bl	for0(PLT)
	mov	r2, r0
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
	ldmfd	sp!, {fp, pc}
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

完成这一步只是将.i文件转为了汇编，但还不是二进制

# 汇编

这一步才将汇编代码转为二进制，可以通过-c查看

```
gcc -c hello.s -o hello.o
```

这一步会生成.o，但是还不能执行，因为程序执行还得依赖其他库，不然上面的print他的真实实现在哪里

# 链接

这一步就是讲上面编译的二进制文件和他依赖的库链接成可以执行文件

```
gcc hello.o -o hello
```

这一步就可以生成hello文件了，我们将他上传到手机，就可以执行了

> 注意：由于我们是在mac上编译出arm可执行文件，所以得用交叉编译器ndk里面的gcc,所以我们还需要如下makefile

makefile

```makefile
NDK_ROOT=/Users/renpingqing/Documents/android/android-ndk-r11c
TOOLCHAINS_ROOT=$(NDK_ROOT)/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64
TOOLCHAINS_PREFIX=$(TOOLCHAINS_ROOT)/bin/arm-linux-androideabi
TOOLCHAINS_INCLUDE=$(TOOLCHAINS_ROOT)/lib/gcc/arm-linux-androideabi/4.9/include-fixed

PLATFORM_ROOT=$(NDK_ROOT)/platforms/android-14/arch-arm
PLATFORM_INCLUDE=$(PLATFORM_ROOT)/usr/include
PLATFORM_LIB=$(PLATFORM_ROOT)/usr/lib

MODULE_NAME=hello
RM=rm -rf

FLAGS=-I$(TOOLCHAINS_INCLUDE) \
	-I$(PLATFORM_INCLUDE) \
	-L$(PLATFORM_LIB) \
	-nostdlib \
	-lgcc \
	-Bdynamic \
	-lc

OBJS=$(MODULE_NAME).o \
	$(PLATFORM_LIB)/crtbegin_dynamic.o \
	$(PLATFORM_LIB)/crtend_android.o

all:
	#$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) -c $(MODULE_NAME).c -o $(MODULE_NAME).o
	#$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) $(OBJS) -o $(MODULE_NAME)

	#预处理
	$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) -E $(MODULE_NAME).c -o $(MODULE_NAME).i

	#编译
	$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) -S $(MODULE_NAME).i -o $(MODULE_NAME).s

	#汇编
	$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) -c $(MODULE_NAME).s -o $(MODULE_NAME).o

	#链接
	$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) $(OBJS) -o $(MODULE_NAME)
clean:
	$(RM) *.o
install:
	adb push $(MODULE_NAME) /data/local/
	adb shell chmod 755 /data/local/$(MODULE_NAME)
```

hello.c

```c
#include <stdio.h>

int nums[5] = {1,2,3,4,5};

int for0(int n)
{   
    int i = 0;
    int s = 0;
    for(i = 0;i<n;i++)
    {
        s+=i;
    }
    return s;
}

int for1(int n)
{   
    int i = 0;
    int s = 0;
    for(i = 0;i<n;i++)
    {
        s+=i*2;
    }
    return s;
}

int for2(int n)
{   
    int i = 0;
    int s = 0;
    for(i = 0;i<n;i++)
    {
        s+=i*i+nums[n-1];
    }
    return s;
}

int main(int argc,char* argv[])
{
    printf("hello ARM!\n");
    printf("for0%d\n", for0(5));
    printf("for1%d\n", for1(5));
    printf("for2%d\n", for2(5));
    return 0;
}
```