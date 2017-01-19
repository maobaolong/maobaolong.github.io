---
title: React Native
date: 2016-11-14 23:07:23
categories: React Native
tags: 
    - React Native
    - React
---

# 搭建React Native开发环境

## 安装xcode

可以从app Store下载或者在苹果开发者中心下载。

## 安装Command Line Tools

里面包括git这样的命令

```shell
xcode-select --install
```

## 安装homebrew

mac上的一个软件包管理器，和linux上的yum,apt-get差不多

```she
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
```

## 安装watchman

facebook的一个开源项目，用来监视文件并且记录文件改动情况的一个库。

## 安装flow

JavaScript的静态类检查器，用于找出JavaScript代码中的类型错误。

当然推荐是安装完在nodejs开发中常见的依赖：

```shell
brew install flow git gcc pkg-config cairo libpng jpeg mongodb
```

注意：安装mongodb前先要安装pkg-config，makedepend。如果报错：

```shell
Error: You must `brew link pkg-config makedepend` before mongodb can be installed
```

就要链接：

```shell
brew link makedepend
brew link pkg-config
```

## 安装nodejs

建议使用nvm，因为他可以管理多个版本

官方仓库：https://github.com/creationix/nvm

```shell
sudo curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.32.1/install.sh | bash
```

安装完成后就可以执行nvm命令了。

安装nodejs

```shell
nvm install v4.2.3
nvm alias default v4.2.3
```

当前版本为：

➜  ~ node -v
v4.2.3


➜  ~ npm -v
2.14.7

由于国内有时npm仓库有点慢，所以切换淘宝源：

```shell
npm install cnpm -g
```

## 安装react native

安装脚手架

```shell
cnpm install -g react-native-cli@0.1.10 -g
react-native -v
```

## 创建第一个项目

```shell
react-native init firstApp
```

创建完成后会有如下信息:

```
To run your app on iOS:
   cd /Users/renpingqing/Documents/work/react/fistApp
   react-native run-ios
   - or -
   Open /Users/renpingqing/Documents/work/react/fistApp/ios/fistApp.xcodeproj in Xcode
   Hit the Run button
To run your app on Android:
   Have an Android emulator running (quickest way to get started), or a device connected
   cd /Users/renpingqing/Documents/work/react/fistApp
   react-native run-android
```

现在就可以运行试试看。

运行完后，我可以尝试修改一些代码，来看看效果，但是如果每次修改都刷新模拟器(command+r)这很痛苦的，我们可以通过(command+d)，开启live reload，就可以实现每次保存源代码就自动刷新的功能了。

## 配置subline

首选安装package control(https://packagecontrol.io),这是一个专门管理sb的包网站。安装方法

点击网页的install now，左边会显示安装代码，只需要将这些复制到sb，按control+~贴入代码，安装完成后可以通过command+shift+p呼出package control的窗口。

输入install，然后输入要安装的包，回车就可以安装了。这里安装babel,sublimelinter-jsxhint(安装了就不会提示)。

安装完成后就可以通过sb的view-syntax-open all*-babel-javaScript(babel)，就能将当前语法识别为jsx。

还可以安装gitgutter，sublimelinter,sublimelinter-contrib-eslint。

## 安装全局exhint检查

```java
npm install -g eslint babel-eslint --registry=http://registry.npm.taobao.org
```

# react-native项目结构

可以看做是一个node js项目因为根目录有一个package.json文件，对应一个node_modules的文件夹是该项目的依赖。他下面有个react-native下面又有local-cli和packager(终端打开启动的package就是他)，同时还有一个node_modules，他就是react-native框架所依赖的库。

在最外层可以看到有ios和android目录分别对应相应平台的代码。

.flowconfig：js语法检查规则

.gitignore:版本控制忽略文件

.watchmanconfig：watchman配置文件



index.ios.js结构：

```javascript
import React, { Component } from 'react';
import {
  AppRegistry,
  StyleSheet,
  Text,
  View
} from 'react-native';
```

导入要用到的模块语法，结构赋值es6语法。表示从react-native导出了Text，View等。有点像python的导入。

```javascript
export default class fistApp extends Component {
  render() {
    return (
      <View style={styles.container}>
        <Text style={styles.welcome}>
          Welcome to React a!
        </Text>
        <Text style={styles.instructions}>
          To get started, edit index.ios.js
        </Text>
        <Text style={styles.instructions}>
          Press Cmd+R to reload,{'\n'}
          Cmd+D or shake for dev menu
        </Text>
      </View>
    );
  }
}
```

继承Component实现一个类，并实现render方法，返回一些jsx语法的内容。

```javascript
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },
  instructions: {
    textAlign: 'center',
    color: '#333333',
    marginBottom: 5,
  },
});
```

样式代码

```javascript
AppRegistry.registerComponent('fistApp', () => fistApp);
```

注册RN的入口代码。

# 统计按钮点击次数

现在项目已经跑起来了，我做一个统计屏幕点击次数的例子

index.ios.js

我们将render方法改为如下：

```javascript
render() {
  return (
    <View style={styles.container}>
      <Text style={styles.welcome} onPress={this.timesPlus.bind(this)}>
        你敢点击我吗
      </Text>
      <Text style={styles.instructions}>
        点击了 {this.state.times} 次
      </Text>
    </View>
  );
}
```

并给第一个Text绑定了一个onPress事件，点击时就会调用timesPlus方法

```javascript
timesPlus(){
  let times=this.state.times

  times++

  this.setState({
    times:times
  })
}
```

逻辑就是拿到当前state里面的times加1，然后在赋值回去。完整代码

```javascript
/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 */

import React, {
  AppRegistry,
  Component,
  StyleSheet,
  Text,
  View
} from 'react-native';

class dog extends Component {
  constructor(props){
    super(props)
    this.state={times:0}
  }

  timesPlus(){
    let times=this.state.times

    times++

    this.setState({
      times:times
    })
  }

  render() {
    return (
      <View style={styles.container}>
        <Text style={styles.welcome} onPress={this.timesPlus.bind(this)}>
          你敢点击我吗
        </Text>
        <Text style={styles.instructions}>
          点击了 {this.state.times} 次
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },
  instructions: {
    textAlign: 'center',
    color: '#333333',
    marginBottom: 5,
  },
});

AppRegistry.registerComponent('dog', () => dog);
```

# 组件生命周期

先上一张图

![](http://7qnc6h.com1.z0.glb.clouddn.com/Screen%20Shot%202016-12-01%20at%2011.09.48%20PM.png)

第一次组件

```javascript
componentWillMount
render
componentDidMount
```

状态改变

```javascript
shouldComponentUpdate
componentWillUpdate
render
componentDidUpdate
```

## 嵌套组件

### 第一次加载

father getDefaultProps
son getDefaultProps
father getInitialState
father componentWillMount
father render
son getInitialState
son componentWillMount
son render
son componentDidMount
father componentDidMount

可以看到先渲染父组件，然后渲染子组件

### 父组件状态变化

father shouldComponentUpdate
father componentWillUpdate
father render
son getInitialState
son componentWillMount
son render
son componentDidMount
father componentDidUpdate

### 只有子组件变化

son shouldComponentUpdate
son componentWillUpdate
son render
son componentDidUpdate

测试该组件生命周期的代码如下：

```javascript
/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 */
var React=require('react-native')

var {
  AppRegistry,
  Component,
  StyleSheet,
  Text,
  View
} = React;

var life = React.createClass( {
  getDefaultProps(){
    console.log('father getDefaultProps')
  },

  getInitialState(){
    console.log('father getInitialState')
    return {
      times:3,
      hit:false
    }
  },

  componentWillMount(){
    console.log('father componentWillMount')
  },

  componentDidMount(){
    console.log('father componentDidMount')
  },

  shouldComponentUpdate(){
    console.log('father shouldComponentUpdate')

    return true
  },

  componentWillUpdate(){
    console.log('father componentWillUpdate')
  },

  componentDidUpdate(){
    console.log('father componentDidUpdate')
  },

  timePlugs(){
   var times= this.state.times

   times+=3

   this.setState({
    times:times
   })
  },

  timeReset(){
   this.setState({
    times:0
   })
  },

  willHit(){
   this.setState({
    hit:!this.state.hit
   })
  },

  render() {
    console.log('father render')

    return (
      <View style={styles.container}>

        {
          this.state.hit 
          ? 
          <Son times={this.state.times} timeReset={this.timeReset}/> 
          : null

        }

        
        <Text style={styles.welcome} onPress={this.timeReset}>
        老子说：心情好就放你一马
        </Text>

        <Text style={styles.instructions} onPress={this.willHit}>
          到底揍不走
        </Text>

        <Text style={styles.instructions}>
          就揍了你 {this.state.times} 次而已
        </Text>

        <Text style={styles.instructions} onPress={this.timePlugs}>
          不听话在揍你 3 次
        </Text>

      </View>
    );
  }
  ,
})

var Son = React.createClass( {
  getDefaultProps(){
    console.log('son getDefaultProps')
  },

  getInitialState(){
    console.log('son getInitialState')
    return {
      times:this.props.times
    }
  },

  componentWillMount(){
    console.log('son componentWillMount')
  },

  componentDidMount(){
    console.log('son componentDidMount')
  },

  componentWillReceiveProps(props){
    console.log('son componentWillReceiveProps')
    console.log(this.props)
    console.log(props)
    this.setState({
      times:props.times
    })
  }
  ,

  shouldComponentUpdate(){
    console.log('son shouldComponentUpdate')

    return true
  },

  componentWillUpdate(){
    console.log('son componentWillUpdate')
  },

  componentDidUpdate(){
    console.log('son componentDidUpdate')
  },

  timeReset(){
    this.props.timeReset()
  },

  //儿子自己的方法，心理暗示老子要揍他，但其实老子没有揍他
  timePlugs(){
   var times= this.state.times

   times+=3

   this.setState({
    times:times
   })
  },

  render() {
    console.log('son render')

    return (
      <View style={styles.container}>
        <Text style={styles.welcome} onPress={this.timePlugs}>
          儿子说：有本事揍我呀！
        </Text>


      <Text style={styles.instructions}>
        你居然揍我 {this.state.times} 次
      </Text>
      <Text style={styles.instructions} onPress={this.timeReset} >
        别揍我了，我给你买瓶酒
      </Text>
      </View>
    );
  }
})

var styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },
  instructions: {
    textAlign: 'center',
    color: '#333333',
    marginBottom: 5,
  },
});

AppRegistry.registerComponent('life', () => life);
```

# ES5和ES6区别

## 导入模块方式

```javascript
 //ES5
var ReactNative=require('react-native')
var React=require('react')

var Component=React.Component

var AppRegistry=ReactNative.AppRegistry
var StyleSheet=ReactNative.StyleSheet
var Text=ReactNative.Text
var View=ReactNative.View

//ES6
// import React,{Component} from 'react'
// import {
//   AppRegistry,
//   StyleSheet,
//   Text,
//   View
// } from 'react-native'
```

## 创建组件

ES5使用React.createClass方法来创建一个组件，所以最后需要添加分号(但也有省略)

```javascript
var life = React.createClass( {
  getInitialState(){
    console.log('father getInitialState')
    return {
      times:3,
      hit:false
    }
  },

  timePlugs(){
   var times= this.state.times

   times+=3

   this.setState({
    times:times
   })
  },

  timeReset(){
   this.setState({
    times:0
   })
  },

  willHit(){
   this.setState({
    hit:!this.state.hit
   })
  },

  render() {
    console.log('father render')

    return (
      <View style={styles.container}>

        {
          this.state.hit 
          ? 
          <Son times={this.state.times} timeReset={this.timeReset}/> 
          : null

        }

        
        <Text style={styles.welcome} onPress={this.timeReset}>
        老子说：心情好就放你一马
        </Text>

        <Text style={styles.instructions} onPress={this.willHit}>
          到底揍不走
        </Text>

        <Text style={styles.instructions}>
          就揍了你 {this.state.times} 次而已
        </Text>

        <Text style={styles.instructions} onPress={this.timePlugs}>
          不听话在揍你 3 次
        </Text>

      </View>
    );
  }
})
```

ES6使用class和extends关键字来实现，和Java这样的语言差不多了，更加面向对象了

```javascript
class Son extends Component {
  constructor(props){
    super(props)
    this.state={times:0}

    console.log('son constructor')
  }

  componentWillReceiveProps(props){
    console.log('son componentWillReceiveProps')
    console.log(this.props)
    console.log(props)
    this.setState({
      times:props.times
    })
  }
  
  timeReset(){
    this.props.timeReset()
  }

  //儿子自己的方法，心理暗示老子要揍他，但其实老子没有揍他
  timePlugs(){
   var times= this.state.times

   times+=3

   this.setState({
    times:times
   })
  }

  render() {
    console.log('son render')

    return (
      <View style={sonStyles.container}>
        <Text style={sonStyles.welcome} onPress={this.timePlugs.bind(this)}>
          儿子说：有本事揍我呀！
        </Text>


      <Text style={sonStyles.instructions}>
        你居然揍我 {this.state.times} 次
      </Text>
      <Text style={sonStyles.instructions} onPress={this.timeReset.bind(this)} >
        别揍我了，我给你买瓶酒
      </Text>
      </View>
    );
  }
}
```

## 获取初始属性

ES5中使用getDefaultProps和getInitialState来初始化属性

```javascript
getDefaultProps(){
	console.log('father getDefaultProps')
},

getInitialState(){
	console.log('father getInitialState')
	return {
	  times:3,
	  hit:false
	}
},
```

ES6中使用constructor构造方法来初始化

```javascript
constructor(props){
  super(props)
  this.state={times:0}

  console.log('son constructor')
}
```

## View中调用方法

ES5

```javascript
<Text style={styles.instructions} onPress={this.timePlugs}>
  不听话在揍你 3 次
</Text>
```

ES6要调用bind(this)方法

```javascript
<Text style={sonStyles.welcome} onPress={this.timePlugs.bind(this)}>
  儿子说：有本事揍我呀！
</Text>
```

## 声明变量

ES5中只能使用var

ES6中可以使用const，let

# 常用组件

首先我们clone react native的源码到本地，并切换到 0.22-stable版本，然后使用npm start安装依赖，如果这个版本安装出错

```shell
npm ERR! Darwin 15.6.0
npm ERR! argv "/Users/renpingqing/.nvm/versions/node/v4.2.3/bin/node" "/Users/renpingqing/.nvm/versions/node/v4.2.3/bin/npm" "install"
npm ERR! node v4.2.3
npm ERR! npm  v2.14.7
npm ERR! code EPEERINVALID

npm ERR! peerinvalid The package eslint@2.13.1 does not satisfy its siblings' peerDependencies requirements!
npm ERR! peerinvalid Peer babel-eslint@5.0.4 wants eslint@<2.3.0

npm ERR! Please include the following file with any support request:
npm ERR!     /Users/renpingqing/Documents/work/react/react-native/npm-debug.log
```

那我们切换到0.24-stable试试

```shell
rm -rf node_modules && npm install
```

我们当前的版本是xcode8.1,node是v4.2.3，react-native-cli: 0.2.0。

我们可以在Examples目录找到多个实例代码，其中UIExplorer就是控件示例代码。

## View

相当于支持flex布局的div

## Text

用来显示文本的，可以设置显示的字体大小，颜色，显示几行

## TextInput

文本输入框，也可以用来输入密码

## Image

显示图片，可以加载网络，本地图片，还可以监听加载进度，也可以设置图片的拉伸方式

## AlertIOS

提示框

## Modal

模态对话框，浮层

## ActivityIndicatorIOS

loading

## ProgressViewIOS

进度条，提供0~1之间的值

## ListView

## PickerIOS

## StatusBar

可以控制IOS状态栏

## Switch

开关控件

## Slider

滑块

## MapView

## Navigator

## TabBarIOS

## SegmentedControllIOS

## Touchable

## WebView

# flex布局

伸缩，弹性容器布局

> 注意：RN的flex跟css3里的flexbox属性名写法不同，RN全部使用驼峰标示
>
> RN对flex的支持有限是css3 flexbox的一个子集

## 父容器

### flexDirection

可以控制字项目的排列方式通过flexDirection

默认值是column,标示垂直，row标示水平

### flex:1

标示让当前这个容器的宽高都充满父容器

### flexWrap

定义如果在这个方向上放不下的其他元素显示方式

noWrap:不包裹，就在屏幕外面去了

wrap:包裹，换行显示

### justifyContent

设置在排列方向上的位置

flex-start:左边

center:居中

flex-end:右边

space-between:两段对齐

space-around:将空间平分，并在平分的空间中在居中

### alignItems

控制在垂直于排列方式的内容位置

stretch:在纵轴拉升

## 子容器

子容器可以使用alignSelf覆盖父类的设置

子容器可是使用flex:1来指定平分父容器的空间，这个值相当于android中的weight属性

# 如挑选第三方组件

star个数

fork

close pr

close issues

stackoverflow

文档全，代码规范，测试用例

比如：我们搜索一个轮播组件，可以搜索关键词，react native carousel，react-native-swiper

除了在github上搜索，也可以到https://react.parts/native上搜索

# 本地存储

RN提供了AsyncStorage，采用键值对存储

```javascript
var user=this.state.user

AsyncStorage.setItem('user',JSON.stringify(user),function (err) {
    if (err) {
      console.log(err)
      console.log('save fail')
    } else{
      console.log('save ok')
    }
})

//或者
var user=this.state.user

AsyncStorage
  .setItem('user',JSON.stringify(user))
  .then(function(){
    console.log('save ok')
  })
  .catch(function (err) {
      console.log(err)
      console.log('save fail')
  })
```

统计重新载入的次数

```javascript
componentDidMount(){
    var that = this
      AsyncStorage
      .getItem('user')
      .then(function(data){
        var userData=JSON.parse(data)
        
        userData.times++

          that.setState({
            user:userData
          })

          AsyncStorage
            .setItem('user',JSON.stringify(userData))
            .then(function(){
              console.log('save ok')
            })
            .catch(function (err) {
                console.log(err)
                console.log('save fail')
            })
        console.log()
      })
      .catch(function (err) {
          var user=that.state.user

          AsyncStorage
            .setItem('user',JSON.stringify(user))
            .then(function(){
              console.log('save ok')
            })
            .catch(function (err) {
                console.log(err)
                console.log('save fail')
            })
      })
  }
```

key不存在会走到catch中

删除,key不存在也不会报错

```javascript
AsyncStorage.removeItem('user')
        .then(function () {
          console.log('remove ok')
        })
```

批量操作

```javascript
var that = this

var user=this.state.user

// AsyncStorage.multiSet([['user1','u1'],['user2','u2']])
//   .then(function () {
//     console.log('save ok')
//   })

// AsyncStorage.multiGet(['user1','user2','user'])
//   .then(function (data) {
//     console.log(data) //数组
//   })

  AsyncStorage.multiRemove(['user1','user2','user'])
    .then(function (err) {
      if (err) {
        console.log('remove fail')
      }else{
        console.log('remove ok')
        
        //再次获取数据是，value是空，可以还在
        AsyncStorage.multiGet(['user1','user2','user'])
          .then(function (data) {
            console.log(data)
          })

      }
    })
```

## 

# 调试和热加载

按command+d，可以开启调试和热加载

# 常见错误

## "CFBundleIdentifier", Does Not Exist

Command failed: /usr/libexec/PlistBuddy -c Print:CFBundleIdentifier build/Build/Products/Debug-iphonesimulator/imoocApp.app/Info.plist

Print: Entry, ":CFBundleIdentifier", Does Not Exist

## 用rninit创建指定版本的应用

```javascript
1. 安装
npm i -g rninit
2. 使用
2.1 用最新的 react-native 版本创建工程：
rninit init [Project Name]
2.2 用特定的 react-native npm 版本创建工程：
rninit init [Project Name] --source react-native@0.22.2
```



或者将依赖改为如下：

```json
"lodash": "^4.13.1",
"mockjs": "^1.0.0",
"query-string": "^4.2.0",
"react": "^0.14.8",
"react-native": "^0.22.2",
"react-native-audio": "^1.2.1",
"react-native-button": "^1.6.0",
"react-native-cli": "^0.2.0",
"react-native-image-picker": "^0.20.0",
"react-native-progress": "^3.0.1",
"react-native-sk-countdown": "^1.0.1",
"react-native-swiper": "^1.4.6",
"react-native-vector-icons": "^2.0.2",
"react-native-video": "^0.8.0",
"sha1": "^1.1.1"
```

http://coding.imooc.com/learn/questiondetail/1708

## React-native Cannot find module 'invariant'

升级了node,和react-native-cli后，初始项目报错，我手动安装了下invariant模块，再次初始化项目居然可以了

```shell
npm install invariant
```

这个模块的地址https://www.npmjs.com/package/invariant

## ListView的renderRow方法this指向不对

解决方法是，调用_renderRow方法然后在调用bind(this)

```javascript
<ListView
  dataSource={this.state.dataSource}
  renderRow={this._renderRow.bind(this)} />
```

这样在_renderRow方法中获取this，就能得到正确的指示了

## node v7.3.0集成react-native-vector-icons报错

第一个错误是，找不到模块，用的是react-native link方式操作的。解决方法是，手动在xcode链接。

第二个错误是，找不到字体，这个问题是，拷贝字体是没有勾选target。也就是说字体没有打包到ipa中。

https://github.com/oblador/react-native-vector-icons

http://blog.csdn.net/sakulafly/article/details/46368173

## ios9 http不能访问

https://segmentfault.com/a/1190000002933776




