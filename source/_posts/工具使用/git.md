---
title: git
date: 2016-11-09 15:13:48
tags: [工具使用,git]
categories: 工具使用
keywords: 工具使用,git
description: 记录git的常用命令。
---

## git push origin master报错
fatal: could not read Username for 'https://github.com': No such file or directo
原因使用https方式的时候 在git remote add origin 的https url 里面没有用户名和密码
修改为如下：
git remote add origin https://{username}:{password}@github.com/{username}/project.git
https://github.com/kemayo/sublime-text-git/issues/176
或者直接修改 .git/config 隐藏文件 为git remote add origin https://{username}:{password}@github.com/{username}/project.git 格式




## 显示当前分支

git branch

## 显示远程信息

git remote -v


## 强制回退到master分支

取回远程主机某个分支的更新，再与本地的指定分支合并
git pull <远程主机名> <远程分支名>:<本地分支名>
git pull origin master:master -f

## 显示git状态

git status

git branch * master


## 将master分支合并到当前分支

git merge master



## 将远程master的修改合并到本地mbl分支。

git pull origin master:master -f
git add .
 git commit -m "test"
git pull origin master:master -f
git branch * master
git checkout mbl
git pull
git merge master
 git push



## 取消commit 和 pull

git reset --hard <commit_id>
git push origin HEAD --force


## git 更换仓库
1. 从原地址克隆一份裸版本库，比如原本托管于 GitHub
git clone --bare git://github.com/username/project.git
2. 然后到新的 Git 服务器上创建一个新项目，比如 GitCafe。
3. 以镜像推送的方式上传代码到 GitCafe 服务器上。
```
cd project.git
git push --mirror git@gitcafe.com/username/newproject.git
```
4. 先查看remote的名字
```
git branch -r
```
5. 假设你的remote是origin，用git remote set_url 更换地址
```
git remote set-url origin remote_git_address
```


## 提交代码
```
git commit -am "提交说明"
```

## 追踪远端更新
- 为了将远程的Alluxio源码改动更新到你本地的副本中，你需要创建一个指向远程Alluxio源代码库的源。在刚拷贝的副本的目录下，运行：
```bash
git remote add upstream https://github.com/Alluxio/alluxio.git
```
- 显示所有分之，并比较本地和远端分之版本
```bash
git branch -av
```
- 把远端的分支抓取过来
```bash
git fetch
```
- 合并远程分支
```bash
git checkout master
git merge upstream/master
```
- 切换到分支
```bash
git checkout --track remotes/upstream/branch-1.4
```

- revert file,such as pom.xml
```
git checkout -- pom.xml
git push origin branch-1.4
```


- merge master branch
```bash
git checkout master
git merge upstream/master
git branch -av
git status 
git push
```


- create a sub branch of an assigned branch
```bash
#切换到分支
git checkout branch1

#基于该分支创建子分支
git checkout -b branch2_based_on_b1 branch1 

```

- 为推送当前分支并建立与远程上游的跟踪
```bash
git push --set-upstream origin mbl-baseon-JDAlluxio-1.3.0
```

## 
```bash
# checkout时和提交时都用已有的换行符，不做替换
$ git config --global core.autocrlf false
# checkout时不转换，提交的时候自动转换为LF
$ git config --global core.autocrlf input
```