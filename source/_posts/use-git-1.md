---
title: Git使用笔记(一)
date: 2016-06-29 17:02:39
categories: Git
tags: 
    - Git
---
# 简介

这篇文章就不谈什么git原理，git和其他版本控制系统的优势，只记录常用的，不过这些已经够大家工作中使用了

## 查看git版本
git version

# 获取一个版本库

这个步骤有两个方式，一个是新项目，直接创建，一个是clone一个已有项目

git init 
当面目录会自动生成一个.git目录

初始化到当前目录上一层的a目录里
git init ../a

git clone https://github.com/ruby/ruby.git
在当前目录下创建一个ruby目录，里面才是clone下来的内容

git clone https://github.com/ruby/ruby.git --depth=2
克隆最近两个提交记录，但内容还是全的

git clone -b ruby_2_1 https://github.com/ruby/ruby.git
只克隆ruby_2_1分支

git clone https://github.com/ruby/ruby.git ruby-clone
克隆到ruby-clone目录

# 查看状态
git status

# 跟踪文件
这一步是讲文件添加到暂存区

git add a.txt

# 提交

git commit -m "init"

# 忽略一些文件

是在当前目录下创建.gitignore，如：

```bash
# 忽略所有 .a 结尾的文件
*.a

# 但 lib.a 除外
!lib.a

# 仅仅忽略项目根目录下的 TODO 文件，不包括 subdir/TODO
/TODO
# 忽略 build/ 目录下的所有文件,app/build/目录也会忽略
build/

# 会忽略 doc/notes.txt 但不包括 doc/server/arch.txt
doc/*.txt

# ignore all .txt files in the doc/ directory
doc/**/*.txt

#忽略当前目录下0-9.txt
[0-9].txt

# 忽略dbg文件和dbg目录
dbg

# 只忽略dbg文件，不忽略dbg目录
dbg
!dbg/

# 只忽略当前目录下的dbg文件和目录，子目录的dbg不在忽略范围内
/dbg
```

# 查看状态
git status

精简模式
git status -s
输出
```bash
 M 11.txt
?? 12.txt
```

# 差异比较
工作目录和暂存区域
git diff

比较git add后的文件和git commit后的文件，Git 1.6.1 及更高版本还允许使用 git diff --staged，效果是相同的，但更好记些。）
git diff --cached

# 提交
git add
git commit -m "init"

跳过add，第一次新添加的文件，必须git add，以后的更新，可以使用这条命令
git commit -a -m "init"


# 移除文件
要移除某个文件，先从暂存区移除，在提交

未添加到版本控制的直接删除就行了

提交了的，
git rm a.txt

添加到了暂存，修改了的
git rm -f a.txt

删除了都要git commit

删除暂存或者已经提交了的文件，但不在系统里删除（将某个从跟踪系统中去除）
git rm --cached a.txt


> $ git rm log/\*.log
注意到星号 * 之前的反斜杠 \， 因为 Git 有它自己的文件模式扩展匹配方式，所以我们不用 shell 来帮忙展开。 此命令删除 log/ 目录下扩展名为 .log 的所有文件。 类似的比如：

> $ git rm \*~
该命令为删除以 ~ 结尾的所有文件。

# 移动文件

git mv 30.txt 31.txt
它相当于运行下面三条命令

mv README.md README
git rm README.md
git add README

# 查看提交历史
输出历史课查看：http://www.ruanyifeng.com/blog/2012/08/how_to_read_diff.html

git log

左侧显示分支的演变
git log --graph

显示两条并显示每次提交的内容差异
git log -p -2

显示每次提交的初略信息，所有被修改过的文件、有多少文件被修改了以及被修改过的文件的哪些行被移除或是添加了。 在每次提交的最后还有一个总结
git log --stat

格式化输出(https://git-scm.com/book/zh/v2/Git-基础-查看提交历史)
git log --pretty=format:"%h - %an, %ar : %s"

近两周的修改
git log --since=2.weeks

查看删除了或添加了function_name的提交(从有到无或从无到有)
it log -Sfunction_name

显示作者是pinging的提交，可以配置renpingqing等
git log --author pingqing

匹配提交的字符串内容
git log --grep error

查看至于a.txt有关的提交
git log -- a/b/c.txt 

查看2008 年 10 月期间，Junio Hamano 提交的但未合并的测试文件
git log --pretty="%h - %s" --author=gitster --since="2008-10-01" \
   --before="2008-11-01" --no-merges -- t/

# 撤销

修改提交信息，他会修改最近一次提交信息
git commit --amend

忘记提交了某些文件，最后一次提交会覆盖initial commit信息
git commit -m 'initial commit'
git add forgotten_file
git commit --amend

## 取消暂存的文件
比如遇到这种情况，假设我工作目录有两个文件，我想要的是一个文件提交一次，但是不小心执行了git add .
这时候只需要将文件从暂存区撤销回来
git reset HEAD 2.txt

撤销当前改动的文件，未添加到工作区
git checkout a.txt

撤销添加到了暂存区的文件
TODO

# 远程仓库的使用

## 查看远程仓库
git remote

显示链接地址
git remote -v

显示远程仓库详细信息(当前分支，远程分支，本地分支)
git remote show origin

## 添加远程仓库
git remote add pb https://github.com/paulboone/ticgit

## 从远程仓库中抓取与拉取

不会自动合并(如果有分支，他只会创建origin/new，不会再本地创建副本)
git fetch [remote-name]

可以合并到当前分支(https://git-scm.com/book/zh/v2/Git-分支-远程分支)
git merge origin/serverfix

也可以创建一个副本分支，在上面工作
git checkout -b serverfix origin/serverfix

自动合并
git pull

推送到远程仓库
git push origin master

重名了远程名称
git remote rename pb paul

删除远程
git remote rm paul

更改origin为test
git clone -o test https://github.com/lifengsofts/TestMvp.git

# 标签

## 创建标签

查看所有标签
git tag

git tag -l 'v1.8.5*'

## 创建标签

Git 使用两种主要类型的标签：轻量标签（lightweight）与附注标签（annotated）。

轻量标签：很像一个不会改变的分支 - 它只是一个特定提交的引用
附注标签：是存储在 Git 数据库中的一个完整对象。 它们是可以被校验的；其中包含打标签者的名字、电子邮件地址、日期时间；还有一个标签信息；并且可以使用 GNU Privacy Guard （GPG）签名与验证。 

**通常建议创建附注标签**

git tag -a v1.4 -m 'my version 1.4'

git tag -a v1.4

创建轻量标签
git tag v1.0.1

查看这个标签的提交信息
git show v1.4

给过去的提交添加标签
git tag v1.0.2 bceebb55[47da220c63eecc6a9793486c387b8475]

push标签
git push origin v1.5

git push origin --tags

检出标签(比如：某个tag的出现bug，需要在当前bug创建一个分支)
git checkout -b fix-v2.0.0 v2.0.0

检出远程分支
 git checkout --track origin/serverfix

等同于上面
git checkout -b serverfix origin/serverfix

# 别名

查看配置
git config --list

git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.st status

# 分支

## 创建分支

git branch test1

在当前分支上创建分支，并切换到新分支
git checkout -b test2

check出远程分支
git checkout -b test2 origin/test2

## 查看分支

git branch

显示远程和本地分支
git branch -a

查看各个分支当前所指的对象
git log --oneline --decorate

分支切换
git checkout test2

查看分叉历史
git log --oneline --decorate --graph --all

查看远程分支，包括远程tag
git ls-remote 

## 合并分支

先切换到要合并到的分支

比如：要讲fix-255分支合并到master

git checkout master

先拉去远程的内容，因为在这其他有可能其他更改了
git pull

快速合并
git merge fix-255

git merge --no-ff fix-255

查看每个分支最后一次提交
git branch -v

查看问未合并分支(实现，一直在合并的分支)
https://git-scm.com/book/zh/v2/Git-分支-分支管理

## 推送分支

git push origin serverfix

将本地分支server fix推送到远程为awesomebranch
git push origin serverfix:awesomebranch

## 删除远程分支

删除本地分支
git branch -d fix1

删除服务端分支
git push origin --delete serverfix

## 上游分支

https://git-scm.com/book/zh/v2/Git-分支-远程分支

查看所有跟踪分支
git branch -vv

先获取，在查看
git fetch --all
git branch -vv